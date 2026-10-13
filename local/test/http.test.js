import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let child, directory, base, cookie, csrf;
async function request(path, data, extra = {}) {
  const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Cookie: cookie ?? '', ...(data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...extra }, body: data ? JSON.stringify(data) : undefined });
  return { response, data: await response.json() };
}
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'threshold-http-'));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { env: { ...process.env, PORT: String(port), DB_PATH: join(directory, 'http.sqlite'), AGENTROUTER_API_KEY: '', AGENTROUTER_TRANSPORT: 'api' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Test server failed to start')), 10000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}`)); }); });
  const start = await request('/api/state'); cookie = start.response.headers.get('set-cookie').split(';')[0]; csrf = start.data.csrf;
});
after(async () => {
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  if (directory) rmSync(directory, { recursive: true, force: true });
});
test('HTTP lifecycle exposes a real persistent effect and a blocked failure', async () => {
  const start = await request('/api/runs', { scenarioId: 'deploy-safe' });
  assert.equal(start.response.status, 201);
  const evaluated = await request('/api/evaluate', { resourceId: start.data.resource.id, proposal: start.data.proposal });
  assert.equal(evaluated.data.result.decision, 'execute');
  const attempts = await Promise.all(Array.from({ length: 4 }, () => request('/api/execute', { decisionId: evaluated.data.id })));
  assert.ok(attempts.every(r => r.response.status === 200)); assert.equal(attempts.filter(r => !r.data.replay).length, 1);
  const second = await request('/api/runs', { scenarioId: 'deploy-safe' });
  const decision = await request('/api/evaluate', { resourceId: second.data.resource.id, proposal: second.data.proposal });
  await request('/api/fault', { resourceId: second.data.resource.id, type: 'ci-failed' });
  const blocked = await request('/api/execute', { decisionId: decision.data.id });
  assert.equal(blocked.response.status, 409); assert.equal(blocked.data.blocked.currentDecision, 'refuse');
  const state = await request('/api/state'); assert.equal(state.data.effects.length, 1); assert.equal(state.data.integrity.valid, true);
});
test('HTTP rejects missing CSRF and hostile browser origins', async () => {
  assert.equal((await request('/api/runs', { scenarioId: 'refund-safe' }, { 'X-CSRF-Token': '' })).response.status, 403);
  assert.equal((await request('/api/runs', { scenarioId: 'refund-safe' }, { Origin: 'https://untrusted.example' })).response.status, 403);
});
test('HTTP rejects forged policy fields and malformed proposal values', async () => {
  const run = await request('/api/runs', { scenarioId: 'refund-safe' });
  const forged = await request('/api/evaluate', { resourceId: run.data.resource.id, proposal: { amount: 35, note: '', approved: true } });
  assert.equal(forged.response.status, 400);
  assert.equal((await request('/api/evaluate', { resourceId: run.data.resource.id, proposal: { amount: '35', note: '' } })).response.status, 400);
});
test('public assets carry CSP and unknown paths return 404', async () => {
  const response = await fetch(base); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(await response.text(), /Threshold/);
  assert.equal((await fetch(base + '/server.js')).status, 404);
});
test('AI endpoint without configuration makes no model call or decision', async () => {
  const run = await request('/api/runs', { scenarioId: 'refund-safe' });
  const before = (await request('/api/state')).data;
  assert.equal(before.agent.configured, false);
  const generated = await request('/api/agent/propose', { resourceId: run.data.resource.id, request: 'Refund $35.' });
  assert.equal(generated.response.status, 503);
  const after = (await request('/api/state')).data;
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.effects.length, before.effects.length);
});
test('HTTP evidence resolution requires session, CSRF, exact fields, and a matching decision', async () => {
  const run=await request('/api/runs',{scenarioId:'refund-missing'});const record=(await request('/api/evaluate',{resourceId:run.data.resource.id,proposal:run.data.proposal})).data;
  assert.equal((await request('/api/resolve',{decisionId:record.id,type:'identity',confidence:1})).response.status,400);
  assert.equal((await request('/api/resolve',{decisionId:record.id,type:'identity'},{'X-CSRF-Token':''})).response.status,403);
  const next=await request('/api/resolve',{decisionId:record.id,type:'identity'});assert.equal(next.data.result.decision,'execute');assert.equal((await request('/api/execute',{decisionId:record.id})).response.status,409);
});
test('HTTP operator review rejects forged authority, grants a bounded decision, and honors revocation', async () => {
  const run=await request('/api/runs',{scenarioId:'deploy-prod'});const record=(await request('/api/evaluate',{resourceId:run.data.resource.id,proposal:run.data.proposal})).data;
  const review=(await request('/api/state')).data.reviews.find(r=>r.originalDecisionId===record.id),payload={reviewId:review.id,reviewerId:'noor',verdict:'approve',note:'Healthy synthetic release and verified rollback.'};
  assert.equal((await request('/api/review',{...payload,riskLimit:100})).response.status,400);assert.equal((await request('/api/review',{...payload,reviewerId:'observer'})).response.status,403);
  const approved=await request('/api/review',payload);assert.equal(approved.data.record.result.decision,'execute');assert.equal((await request('/api/review/revoke',{reviewId:review.id,reviewerId:'noor'})).response.status,200);assert.equal((await request('/api/execute',{decisionId:approved.data.record.id})).response.status,409);
});
