import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentError } from './agent-error.js';

// Invoke the real supported client. Never manufacture a Claude Code identity
// for a generic HTTP request. No model tools, MCP servers, or saved sessions.
export async function invokeSupportedClient({ config, messages, directory, signal, spawnImpl = spawn }) {
  const cwd = resolve(directory, 'client-workspace');
  const configDirectory = resolve(directory, 'client-config');
  mkdirSync(cwd, { recursive: true }); mkdirSync(configDirectory, { recursive: true });
  const environment = { ...process.env, ANTHROPIC_BASE_URL: new URL(config.endpoint).origin, ANTHROPIC_API_KEY: config.key, ANTHROPIC_MODEL: config.model, CLAUDE_CONFIG_DIR: configDirectory, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '768' };
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.CLAUDECODE;
  const args = ['--bare', '--print', '--model', config.model, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json', '--prompt-suggestions', 'false', '--max-budget-usd', '0.02', '--system-prompt', messages[0].content];
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) return reject(new AgentError(502, 'provider_timeout', 'The supported client timed out. No action was executed.'));
    const child = spawnImpl(config.clientPath, args, { cwd, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', outputBytes = 0, failure;
    const stop = error => { failure = error; signal.removeEventListener('abort', abort); reject(error); child.kill(); child.stdout.destroy?.(); child.stderr.destroy?.(); };
    const abort = () => stop(new AgentError(502, 'provider_timeout', 'The supported client timed out. No action was executed.'));
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { if (failure) return; outputBytes += Buffer.byteLength(chunk); if (outputBytes > 65536) return stop(new AgentError(502, 'invalid_output', 'The supported client returned too much output. No action was authorized.')); output += chunk.toString(); });
    // Consume stderr without logging it: it can contain provider diagnostics.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => { signal.removeEventListener('abort', abort); reject(new AgentError(503, 'client_unavailable', 'The supported Claude Code client could not start. Check CLAUDE_CODE_PATH.')); });
    child.on('close', code => {
      signal.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      let result;
      try { result = JSON.parse(output); } catch { return reject(new AgentError(502, 'invalid_output', 'The supported client returned an invalid response. No action was authorized.')); }
      if (code !== 0 || result.is_error || result.subtype !== 'success') {
        const content = typeof result.result === 'string' ? result.result : '';
        const message = /unauthorized client detected/i.test(content) ? 'AgentRouter rejected the supported client. Ask AgentRouter to check client access.' : /402|budget pool quota/i.test(content) ? 'AgentRouter’s model quota is exhausted. No fallback or application retry was made.' : /max_budget|budget/i.test(String(result.subtype)) ? 'The client reached its estimated per-request cost limit. No action was authorized.' : 'The supported client could not produce a proposal. Check AgentRouter account and model access.';
        return reject(new AgentError(502, 'client_request_failed', message));
      }
      if (typeof result.result !== 'string') return reject(new AgentError(502, 'invalid_output', 'The client returned no proposal text.'));
      resolvePromise({ stop_reason: 'end_turn', content: [{ type: 'text', text: result.result }], usage: result.usage ?? {} });
    });
    child.stdin.end(messages[1].content);
  });
}
