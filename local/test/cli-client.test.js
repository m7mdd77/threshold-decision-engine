import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeSupportedClient } from '../src/cli-client.js';
import { proposeWithAgent } from '../src/agent.js';
import { scenarios, buildResource } from '../src/catalog.js';

const config = { key: 'unit-test-secret', model: 'deepseek-v4-flash', endpoint: 'https://agentrouter.org/v1/chat/completions', format: 'openai', transport: 'claude-code', clientPath: 'trusted-client' };
const messages = [{ role: 'system', content: 'Return one structured proposal.' }, { role: 'user', content: '{"requestText":"Refund $35."}' }];
function fakeChild(result, exitCode = 0, observe) {
  return (_command, args, options) => {
    observe?.(args, options);
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
    child.stdin.on('finish', () => { queueMicrotask(() => { child.stderr.write('sensitive diagnostics unit-test-secret'); child.stdout.write(JSON.stringify(result)); child.emit('close', exitCode); }); });
    return child;
  };
}
async function inTemporaryDirectory(fn) { const directory = mkdtempSync(join(tmpdir(), 'threshold-cli-test-')); try { await fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); } }
test('real-client invocation disables tools, MCP discovery, sessions, and ambient credentials', () => inTemporaryDirectory(async directory => {
  const completion = await invokeSupportedClient({ config, messages, directory, signal: new AbortController().signal, spawnImpl: fakeChild({ subtype: 'success', is_error: false, result: 'OK', usage: { input_tokens: 145, output_tokens: 35 } }, 0, (args, options) => {
    assert.ok(args.includes('--bare')); assert.ok(args.includes('--no-session-persistence')); assert.ok(args.includes('--strict-mcp-config')); assert.equal(args[args.indexOf('--tools') + 1], ''); assert.equal(args[args.indexOf('--model') + 1], 'deepseek-v4-flash');
    assert.ok(!args.join(' ').includes('unit-test-secret')); assert.equal(options.env.ANTHROPIC_API_KEY, 'unit-test-secret'); assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, undefined); assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://agentrouter.org'); assert.equal(options.windowsHide, true);
  }) }); assert.equal(completion.content[0].text, 'OK'); assert.equal(completion.usage.input_tokens, 145);
}));
test('client errors never echo stderr or a provider key', () => inTemporaryDirectory(async directory => {
  await assert.rejects(invokeSupportedClient({ config, messages, directory, signal: new AbortController().signal, spawnImpl: fakeChild({ subtype: 'error_during_execution', is_error: true, result: '401 unit-test-secret invalid' }, 1) }), error => error.code === 'client_request_failed' && !error.message.includes('unit-test-secret'));
}));
test('pool exhaustion is distinct from authentication and never executes an action', () => inTemporaryDirectory(async directory => {
  await assert.rejects(invokeSupportedClient({ config, messages, directory, signal: new AbortController().signal, spawnImpl: fakeChild({ subtype: 'error_during_execution', is_error: true, result: '402 Budget pool quota has been exhausted' }, 1) }), /quota is exhausted/);
}));
test('a client-reported cost limit produces an explicit bounded failure', () => inTemporaryDirectory(async directory => {
  await assert.rejects(invokeSupportedClient({ config, messages, directory, signal: new AbortController().signal, spawnImpl: fakeChild({ subtype: 'error_max_budget_usd', is_error: true }, 1) }), /cost limit/);
}));
test('a cancelled invocation never starts a client process', () => inTemporaryDirectory(async directory => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(invokeSupportedClient({ config, messages, directory, signal: controller.signal, spawnImpl: () => { throw new Error('Must not start'); } }), error => error.code === 'provider_timeout');
}));
test('timeout settles promptly even when a stalled client never closes its pipes',()=>inTemporaryDirectory(async directory=>{
  const controller=new AbortController();let killed=false;
  const promise=invokeSupportedClient({config,messages,directory,signal:controller.signal,spawnImpl:()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed=true;return true;};return child;}});
  controller.abort();let timer;
  try {await assert.rejects(Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timeout did not settle')),100);})]),error=>error.code==='provider_timeout');assert.equal(killed,true);}finally{clearTimeout(timer);}
}));
test('supported-client transport still validates proposals and records token usage', async () => {
  const resource = buildResource(scenarios.find(s => s.id === 'refund-safe'));
  const output = await proposeWithAgent({ config, domain: 'refund', request: 'Refund $35.', resource, clientDirectory: 'test-placeholder', fetchImpl: () => { throw new Error('Direct API must not be called'); }, clientImpl: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ kind: 'proposal', proposal: { amount: 35, note: 'Refund $35.' }, explanation: 'Requested amount is $35.' }) }], usage: { input_tokens: 800, output_tokens: 100 } }) });
  assert.equal(output.proposal.amount, 35); assert.equal(output.usage.total_tokens, 900);
});
test('supported-client output cannot add approval fields', async () => {
  const resource = buildResource(scenarios.find(s => s.id === 'refund-safe'));
  await assert.rejects(proposeWithAgent({ config, domain: 'refund', request: 'Refund $35.', resource, clientDirectory: 'test-placeholder', clientImpl: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ kind: 'proposal', proposal: { amount: 35, note: '', approved: true }, explanation: 'Approved.' }) }] }) }), error => error.code === 'invalid_output');
});
