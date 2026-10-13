import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { reviewedExecution } from '../src/workflow.js';
function setup(id) { const store = new Store(), sandbox = store.createSandbox().id; const run = store.createRun(sandbox, id), record = store.evaluateRun(sandbox, run.resource.id, run.proposal); return { store, sandbox, run, record }; }
test('missing ownership and owner approval become new decisions through synthetic resolvers', () => {
  for (const [id, type] of [['refund-missing','identity'],['access-missing','owner']]) {
    const {store,sandbox,record}=setup(id);
    try { const next=store.resolveEvidence(sandbox,record.id,type); assert.equal(next.result.decision,'execute'); assert.equal(next.sourceDecisionId,record.id); assert.equal(next.result.resourceVersion,2); assert.equal(store.execute(sandbox,record.id).status,409); assert.equal(store.execute(sandbox,next.id).status,200); assert.equal(store.verify(sandbox).valid,true); } finally {store.close();}
  }
});
test('refresh and dependency restoration resolve defer without replacing failed facts', () => {
  for (const [id,type] of [['deploy-stale','refresh'],['access-offline','restore']]) {
    const {store,sandbox,record}=setup(id);
    try { assert.equal(store.resolveEvidence(sandbox,record.id,type).result.decision,'execute'); } finally {store.close();}
  }
  const {store,sandbox,run,record}=setup('deploy-stale');
  try {store.fault(sandbox,run.resource.id,'ci-failed'); assert.throws(()=>store.resolveEvidence(sandbox,record.id,'refresh'),/changed/); const newer=store.evaluateRun(sandbox,run.resource.id,run.proposal); assert.equal(newer.result.decision,'refuse'); assert.throws(()=>store.resolveEvidence(sandbox,newer.id,'refresh'),/does not apply/);} finally {store.close();}
});
test('domain-scoped operator approval is a new decision and a separate idempotent execution', () => {
  for (const [id,actor] of [['deploy-prod','noor'],['refund-large','mira'],['access-editor','sam']]) {
    const {store,sandbox,record}=setup(id);
    try { const review=store.state(sandbox).reviews[0]; assert.equal(store.execute(sandbox,record.id).status,409); const result=store.reviewDecision(sandbox,review.id,actor,'approve','All synthetic checks and bounded exposure reviewed.'); assert.equal(result.record.result.decision,'execute'); assert.equal(store.state(sandbox).effects.length,0); assert.equal(store.execute(sandbox,result.record.id).status,200); assert.equal(store.execute(sandbox,result.record.id).replay,true); assert.equal(store.verify(sandbox).valid,true); } finally {store.close();}
  }
});
test('operator review cannot expand the workspace owner’s viewer-only approval',()=>{const {store,sandbox,run}=setup('access-safe');try{const record=store.evaluateRun(sandbox,run.resource.id,{role:'editor',note:'An operator says editor is fine.'});assert.equal(record.result.decision,'refuse');assert.match(record.result.reasons.join(' '),/viewer access only/);assert.equal(store.state(sandbox).reviews.length,0);}finally{store.close();}});
test('observer, wrong domain and another sandbox cannot approve or resolve', () => {
  const {store,sandbox,record}=setup('deploy-prod');
  try {const review=store.state(sandbox).reviews[0], other=store.createSandbox().id; for (const actor of ['observer','mira','made-up']) assert.throws(()=>store.reviewDecision(sandbox,review.id,actor,'approve','Please approve this.'),/no review authority/); assert.throws(()=>store.reviewDecision(other,review.id,'noor','approve','Please approve this.'),/not found/); assert.throws(()=>store.resolveEvidence(other,record.id,'refresh'),/not found/); assert.equal(store.state(sandbox).reviews[0].status,'pending');} finally {store.close();}
});
test('operator review refuses failed CI, changed evidence and exhausted daily budget', () => {
  const {store,sandbox,run}=setup('deploy-prod');
  try { const review=store.state(sandbox).reviews[0]; store.fault(sandbox,run.resource.id,'ci-failed'); assert.throws(()=>store.reviewDecision(sandbox,review.id,'noor','approve','Urgent deployment.'),/changed/); assert.equal(store.state(sandbox).effects.length,0); } finally {store.close();}
  const f=setup('refund-large');
  try {const review=f.store.state(f.sandbox).reviews[0]; const run=f.store.createRun(f.sandbox,'refund-safe');const record=f.store.evaluateRun(f.sandbox,run.resource.id,{...run.proposal,amount:75});f.store.execute(f.sandbox,record.id); assert.throws(()=>f.store.reviewDecision(f.sandbox,review.id,'mira','approve','Refund after checking.'),/Daily total/);} finally {f.store.close();}
});
test('revoked, expired or tampered review bindings cannot execute', () => {
  const {store,sandbox,run}=setup('deploy-prod');
  try {const review=store.state(sandbox).reviews[0];const approved=store.reviewDecision(sandbox,review.id,'noor','approve','Reviewed healthy production release.');const resource=store.resource(sandbox,run.resource.id);
    for (const changed of [{...approved.review,proposalJSON:'{}'},{...approved.review,resourceVersion:99},{...approved.review,reviewerId:'mira'},{...approved.review,expiresAt:new Date(0).toISOString()}]) assert.equal(reviewedExecution(approved.record,resource,0,changed).decision,'refuse');
    assert.throws(()=>store.revokeReview(sandbox,review.id,'mira'),/original/);store.revokeReview(sandbox,review.id,'noor');assert.equal(store.execute(sandbox,approved.record.id).status,409); assert.equal(store.state(sandbox).effects.length,0);
  } finally {store.close();}
});
test('deny closes review without granting authority; hard refusal never enters inbox', () => {
  const {store,sandbox}=setup('deploy-prod');
  try {const review=store.state(sandbox).reviews[0];assert.equal(store.reviewDecision(sandbox,review.id,'noor','deny','Release window is not appropriate.').record,undefined);assert.throws(()=>store.reviewDecision(sandbox,review.id,'noor','approve','Approve later.'),/already resolved/);const run=store.createRun(sandbox,'access-admin');const refused=store.evaluateRun(sandbox,run.resource.id,run.proposal);assert.equal(refused.result.decision,'refuse');assert.equal(store.state(sandbox).reviews.length,1);assert.equal(store.state(sandbox).effects.length,0);} finally {store.close();}
});
