import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, AppError } from './src/store.js';
import { domains, scenarios } from './src/catalog.js';
import { POLICY_VERSION } from './src/engine.js';
import { validateFields, WorkflowError } from './src/workflow.js';
import { AgentError, AgentRequestGate, agentStatus, readAgentConfig, validateAgentRequest, proposeWithAgent } from './src/agent.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3240);
const host = process.env.HOST ?? '127.0.0.1';
mkdirSync(resolve(root, 'data'), { recursive: true });
const store = new Store(process.env.DB_PATH ?? resolve(root, 'data', 'threshold.sqlite'));
const agentGate = new AgentRequestGate();
const assets = new Map(['/', '/app.js', '/style.css'].map(path => [path, { type: path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css', content: readFileSync(resolve(root, 'public', path === '/' ? 'index.html' : path.slice(1))) }]));
const send = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'Use application/json.');
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 16384) throw new AppError(413, 'Request is too large.'); }
  try { return JSON.parse(data); } catch { throw new AppError(400, 'Invalid JSON.'); }
}
export const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const requestHost = req.headers.host;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (process.env.PUBLIC_ORIGIN) allowedHosts.add(new URL(process.env.PUBLIC_ORIGIN).host);
    if (!allowedHosts.has(requestHost)) throw new AppError(403, 'Host is not configured.');
    const origin = process.env.PUBLIC_ORIGIN ?? `http://${requestHost}`;
    if (req.headers.origin && req.headers.origin !== origin) throw new AppError(403, 'Cross-origin requests are not allowed.');
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method === 'GET' && assets.has(path)) {
      const asset = assets.get(path); res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); return res.end(asset.content);
    }
    if (!path.startsWith('/api/')) throw new AppError(404, 'Route not found.');
    const cookieId = /(?:^|;\s*)threshold=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    let sandbox = cookieId ? store.sandbox(cookieId) : undefined;
    if (!sandbox && req.method === 'GET' && path === '/api/state') {
      sandbox = store.createSandbox();
      res.setHeader('Set-Cookie', `threshold=${sandbox.id}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
    }
    if (!sandbox) throw new AppError(401, 'Open the decision lab to start a sandbox.');
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, { ...store.state(sandbox.id), csrf: sandbox.csrf, policyVersion: POLICY_VERSION, agent: agentStatus(), domains, scenarios: scenarios.map(({ facts, ...scenario }) => scenario) });
    if (req.method === 'GET' && path === '/api/audit') return send(res, 200, { events: store.audit(sandbox.id), integrity: store.verify(sandbox.id) });
    if (req.method !== 'POST') throw new AppError(405, 'Method not allowed.');
    if (req.headers['x-csrf-token'] !== sandbox.csrf) throw new AppError(403, 'Reload the lab before making a change.');
    const input = await body(req);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Request must be an object.');
    if (path === '/api/runs') return send(res, 201, store.createRun(sandbox.id, input.scenarioId));
    if (path === '/api/evaluate') return send(res, 200, store.evaluateRun(sandbox.id, input.resourceId, input.proposal));
    if (path === '/api/resolve') { validateFields(input, ['decisionId', 'type']); return send(res, 200, store.resolveEvidence(sandbox.id, input.decisionId, input.type)); }
    if (path === '/api/review') { validateFields(input, ['reviewId', 'reviewerId', 'verdict', 'note']); return send(res, 200, store.reviewDecision(sandbox.id, input.reviewId, input.reviewerId, input.verdict, input.note)); }
    if (path === '/api/review/revoke') { validateFields(input, ['reviewId', 'reviewerId']); return send(res, 200, store.revokeReview(sandbox.id, input.reviewId, input.reviewerId)); }
    if (path === '/api/agent/propose') {
      if (Object.keys(input).some(key => !['resourceId', 'request'].includes(key))) throw new AppError(400, 'Only resourceId and request are accepted. AI context is loaded by the server.');
      const resource = store.resource(sandbox.id, input.resourceId);
      if (resource.used) throw new AppError(409, 'This run already has a completed action. Choose a fresh scenario.');
      const request = validateAgentRequest(input.request);
      const config = readAgentConfig();
      const release = agentGate.enter(sandbox.id);
      try {
        store.event(sandbox.id, 'agent.requested', { resourceId: resource.id, resourceVersion: resource.version, request, model: config.model });
        const generated = await proposeWithAgent({ domain: resource.domain, resource, request, config, clientDirectory: resolve(root, 'data', 'supported-client') });
        const current = store.resource(sandbox.id, resource.id);
        if (current.version !== resource.version) throw new AgentError(409, 'context_changed', 'The evidence changed while the model was proposing an action. Evaluate a fresh request.');
        const metadata = { provider: generated.provider, model: generated.model, promptVersion: generated.promptVersion, usage: generated.usage, explanation: generated.explanation, request, resourceVersion: resource.version };
        if (generated.kind === 'clarification') {
          store.event(sandbox.id, 'agent.clarification', { ...metadata, resourceId: resource.id, question: generated.question });
          return send(res, 200, generated);
        }
        const decision = store.evaluateRun(sandbox.id, resource.id, generated.proposal, metadata);
        return send(res, 200, { ...generated, record: decision });
      } catch (error) {
        const safe = error instanceof AgentError ? error : new AgentError(500, 'agent_failed', 'The AI proposal could not be recorded. No action was executed.');
        store.event(sandbox.id, 'agent.failed', { resourceId: resource.id, code: safe.code, message: safe.message });
        throw safe;
      } finally { release(); }
    }
    if (path === '/api/execute') { const result = store.execute(sandbox.id, input.decisionId); return send(res, result.status, result); }
    if (path === '/api/fault') return send(res, 200, store.fault(sandbox.id, input.resourceId, input.type));
    if (path === '/api/new-sandbox') {
      const next = store.createSandbox();
      res.setHeader('Set-Cookie', `threshold=${next.id}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
      return send(res, 201, { message: 'New sandbox created. Previous audit records are retained.' });
    }
    throw new AppError(404, 'Route not found.');
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof AgentError) && !(error instanceof WorkflowError)) console.error('Unhandled server error.');
    send(res, error.status ?? 500, { error: error.status ? error.message : 'Unexpected server error; no action was confirmed.' });
  }
});
server.listen(port, host, () => console.log(`Threshold decision lab: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
