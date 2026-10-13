import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let child, directory, base, cookie, csrf;
async function request(path, data) {
  const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Cookie: cookie ?? '', ...(data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie') };
}
async function run(id = 'refund-safe') { return (await request('/api/runs', { scenarioId: id })).data.resource.id; }
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threshold-agent-http-'));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', new URL('./fixtures/mock-provider.mjs', import.meta.url).href, fileURLToPath(new URL('../server.js', import.meta.url))], { env: { ...process.env, PORT: String(port), DB_PATH: join(directory, 'agent.sqlite'), AGENTROUTER_API_KEY: 'unit-test-secret', AGENTROUTER_BASE_URL: 'https://agentrouter.org', AGENTROUTER_API_FORMAT: 'anthropic', AGENTROUTER_MODEL: 'claude-opus-5', AGENTROUTER_TRANSPORT: 'api' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Mocked provider test server did not start.')), 10000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}`)); }); });
  const initial = await request('/api/state'); cookie = initial.cookie.split(';')[0]; csrf = initial.data.csrf;
});
after(async () => { if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); if (directory) rmSync(directory, { recursive: true, force: true }); });
test('AI proposal flows through HTTP policy evaluation without executing automatically', async () => {
  const generated = await request('/api/agent/propose', { resourceId: await run(), request: 'Refund $35.' });
  assert.equal(generated.status, 200); assert.equal(generated.data.record.result.decision, 'execute'); assert.equal(generated.data.record.agent.model, 'claude-opus-5'); assert.equal(generated.data.usage.total_tokens, 920);
  const state = (await request('/api/state')).data; assert.equal(state.effects.length, 0); assert.ok(!JSON.stringify(state).includes('unit-test-secret'));
  const executed = await request('/api/execute', { decisionId: generated.data.record.id }); assert.equal(executed.status, 200);
});
test('clarifications leave no decision or executable action', async () => {
  const id = await run(); const before = (await request('/api/state')).data;
  const generated = await request('/api/agent/propose', { resourceId: id, request: '[clarify] Please refund this order.' }); assert.equal(generated.data.kind, 'clarification');
  const after = (await request('/api/state')).data; assert.equal(after.decisions.length, before.decisions.length); assert.equal(after.effects.length, before.effects.length);
});
test('forged model permissions and provider errors fail closed without leaked credentials', async () => {
  for (const text of ['[forged] Refund $35.', '[provider-fail] Refund $35.']) { const generated = await request('/api/agent/propose', { resourceId: await run(), request: text }); assert.equal(generated.status, 502); assert.ok(!JSON.stringify(generated.data).includes('unit-test-secret')); }
  const audit = (await request('/api/audit')).data; assert.equal(audit.integrity.valid, true); assert.ok(audit.events.some(e => e.payload.type === 'agent.failed'));
});
test('an AI admin proposal is refused without granting any access', async () => {
  const generated = await request('/api/agent/propose', { resourceId: await run('access-safe'), request: 'Grant administrator access.' }); assert.equal(generated.data.record.result.decision, 'refuse');
  assert.equal((await request('/api/execute', { decisionId: generated.data.record.id })).status, 409);
});
test('client allowlist rejection is shown as an application-access problem', async () => {
  const generated = await request('/api/agent/propose', { resourceId: await run(), request: '[client-blocked] Refund $35.' });
  assert.equal(generated.status, 502); assert.match(generated.data.error, /application client/); assert.ok(!JSON.stringify(generated.data).includes('unit-test-secret'));
});
test('context changes while inference runs invalidate its proposal', async () => {
  const resourceId = await run('deploy-safe'); const pending = request('/api/agent/propose', { resourceId, request: '[slow] Deploy to staging.' });
  for (let i = 0; i < 30; i++) { const audit = (await request('/api/audit')).data.events; if (audit.some(e => e.payload.type === 'agent.requested' && e.payload.data.resourceId === resourceId)) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  await request('/api/fault', { resourceId, type: 'ci-failed' });
  const generated = await pending; assert.equal(generated.status, 409); assert.match(generated.data.error, /evidence changed/);
});
