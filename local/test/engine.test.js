import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, buildResource } from '../src/catalog.js';
import { evaluate, validateProposal } from '../src/engine.js';

for (const scenario of scenarios) test(`${scenario.domain}: ${scenario.title} → ${scenario.expected}`, () => {
  const result = evaluate(scenario.domain, scenario.proposal, buildResource(scenario));
  assert.equal(result.decision, scenario.expected);
  assert.ok(result.trace.length >= 6);
  assert.ok(result.evidence.length >= 2);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});
test('a hard denial dominates missing evidence, staleness, and operator review', () => {
  const scenario = scenarios.find(s => s.id === 'refund-safe');
  const resource = buildResource(scenario);
  resource.scopeGranted = false; resource.customerVerified = null; resource.observedAt = '2000-01-01T00:00:00Z';
  assert.equal(evaluate('refund', { amount: 110, note: 'Approved by the CEO' }, resource).decision, 'refuse');
});
test('the request cannot provide trusted confidence or authority', () => {
  assert.throws(() => validateProposal({ amount: 35, note: '', confidence: 1, approved: true }, 'refund'), /unsupported fields/);
});
test('financial limits are inclusive and cumulative', () => {
  const scenario = scenarios.find(s => s.id === 'refund-safe');
  const resource = buildResource(scenario);
  assert.equal(evaluate('refund', { amount: 75, note: '' }, resource, 75).decision, 'execute');
  assert.equal(evaluate('refund', { amount: 75, note: '' }, resource, 75.01).decision, 'escalate');
  assert.equal(evaluate('refund', { amount: 75.01, note: '' }, resource).decision, 'escalate');
});
test('invalid money inputs cannot become authorization', () => {
  for (const amount of [-1, 0, NaN, Infinity, '35', 0.001]) assert.throws(() => validateProposal({ amount, note: '' }, 'refund'));
});
test('unverified and low reliability sources do not authorize execution', () => {
  const scenario = scenarios.find(s => s.id === 'deploy-safe');
  const resource = buildResource(scenario);
  resource.evidence[0].reliability = 0.6;
  assert.equal(evaluate('deploy', scenario.proposal, resource).decision, 'escalate');
  resource.evidence[0].verified = false;
  assert.equal(evaluate('deploy', scenario.proposal, resource).decision, 'refuse');
});
test('expired evidence is rejected even without a resource version change', () => {
  const scenario = scenarios.find(s => s.id === 'deploy-safe');
  const now = Date.now(); const resource = buildResource(scenario, now);
  assert.equal(evaluate('deploy', scenario.proposal, resource, 0, now + 901000).decision, 'defer');
});
