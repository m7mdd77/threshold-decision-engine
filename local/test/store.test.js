import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() { const store = new Store(); const sandbox = store.createSandbox().id; return { store, sandbox }; }
function decide(store, sandbox, id = 'deploy-safe') { const run = store.createRun(sandbox, id); return { run, record: store.evaluateRun(sandbox, run.resource.id, run.proposal) }; }
test('execution writes an effect once and returns the same receipt on retry', () => {
  const { store, sandbox } = setup();
  try { const { record } = decide(store, sandbox); const first = store.execute(sandbox, record.id); const second = store.execute(sandbox, record.id); assert.equal(first.status, 200); assert.equal(second.replay, true); assert.deepEqual(second.effect, first.effect); assert.equal(store.state(sandbox).effects.length, 1); } finally { store.close(); }
});
test('CI failure after approval blocks the old decision without writing an effect', () => {
  const { store, sandbox } = setup();
  try { const { run, record } = decide(store, sandbox); store.fault(sandbox, run.resource.id, 'ci-failed'); const result = store.execute(sandbox, record.id); assert.equal(result.status, 409); assert.equal(result.blocked.currentDecision, 'refuse'); assert.equal(store.state(sandbox).effects.length, 0); assert.ok(store.audit(sandbox).some(e => e.payload.type === 'execution.blocked')); } finally { store.close(); }
});
test('revoked authority blocks execution in every domain', () => {
  const { store, sandbox } = setup();
  try { for (const id of ['refund-safe', 'deploy-safe', 'access-safe']) { const { run, record } = decide(store, sandbox, id); store.fault(sandbox, run.resource.id, 'revoke'); assert.equal(store.execute(sandbox, record.id).status, 409); } assert.equal(store.state(sandbox).effects.length, 0); } finally { store.close(); }
});
test('non-execute decisions cannot be used as permission to write', () => {
  const { store, sandbox } = setup();
  try { for (const id of ['refund-missing', 'deploy-stale', 'deploy-prod', 'access-admin']) { const { record } = decide(store, sandbox, id); assert.equal(store.execute(sandbox, record.id).status, 409); } assert.equal(store.state(sandbox).effects.length, 0); } finally { store.close(); }
});
test('daily budget changes after evaluation are checked at execution', () => {
  const { store, sandbox } = setup();
  try {
    const create = () => { const run = store.createRun(sandbox, 'refund-safe'); return store.evaluateRun(sandbox, run.resource.id, { ...run.proposal, amount: 75 }); };
    const a = create(), b = create(), c = create();
    assert.equal(store.execute(sandbox, a.id).status, 200); assert.equal(store.execute(sandbox, b.id).status, 200);
    assert.equal(store.execute(sandbox, c.id).blocked.currentDecision, 'escalate'); assert.equal(store.spent(sandbox), 150);
  } finally { store.close(); }
});
test('two approvals for one resource cannot apply it twice', () => {
  const { store, sandbox } = setup();
  try { const { run, record } = decide(store, sandbox); const other = store.evaluateRun(sandbox, run.resource.id, run.proposal); store.execute(sandbox, record.id); assert.equal(store.execute(sandbox, other.id).status, 409); assert.equal(store.state(sandbox).effects.length, 1); } finally { store.close(); }
});
test('sandbox IDs cannot access another sandbox’s resource or decision', () => {
  const { store, sandbox } = setup();
  try { const other = store.createSandbox().id; const { run, record } = decide(store, sandbox); assert.throws(() => store.resource(other, run.resource.id), /not found/); assert.throws(() => store.execute(other, record.id), /not found/); } finally { store.close(); }
});
test('audit verifies and detects modification to an existing event', () => {
  const { store, sandbox } = setup();
  try { decide(store, sandbox); assert.equal(store.verify(sandbox).valid, true); store.db.prepare("UPDATE audit SET payload='{}' WHERE sandbox=?").run(sandbox); assert.equal(store.verify(sandbox).valid, false); } finally { store.close(); }
});
test('records and receipts survive closing and reopening SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threshold-store-'));
  const path = join(directory, 'test.sqlite'); let store = new Store(path);
  try { const sandbox = store.createSandbox().id; const { record } = decide(store, sandbox); const first = store.execute(sandbox, record.id); store.close(); store = new Store(path); assert.equal(store.state(sandbox).decisions.length, 1); assert.deepEqual(store.execute(sandbox, record.id).effect, first.effect); assert.equal(store.verify(sandbox).valid, true); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('fault validation rolls back without leaving partial changes', () => {
  const { store, sandbox } = setup();
  try { const { run } = decide(store, sandbox, 'refund-safe'); assert.throws(() => store.fault(sandbox, run.resource.id, 'ci-failed')); assert.equal(store.resource(sandbox, run.resource.id).version, 1); assert.equal(store.verify(sandbox).count, 2); } finally { store.close(); }
});
