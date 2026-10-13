import { evaluate, POLICY_VERSION } from './engine.js';

// These are deliberately named sandbox actors, not authenticated production users.
export const reviewers = [
  { id: 'mira', name: 'Mira · Support manager', domain: 'refund', scope: 'refund:issue', amountLimit: 120, riskLimit: 65 },
  { id: 'noor', name: 'Noor · Release operator', domain: 'deploy', scope: 'deploy:production', riskLimit: 65 },
  { id: 'sam', name: 'Sam · IT operator', domain: 'access', scope: 'access:editor', riskLimit: 55 },
  { id: 'observer', name: 'Observer · No review authority', domain: null }
];
export class WorkflowError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function validateFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw new WorkflowError(400, 'Unsupported workflow fields. Policy and authority are server-derived.');
}
export function resolverOptions(record) {
  if (!record) return [];
  const r = record.resourceSnapshot, options = [];
  if (record.result.decision === 'ask') {
    if (r.domain === 'refund' && r.customerVerified == null) options.push({ id: 'identity', label: 'Verify synthetic account ownership' });
    if (r.domain === 'access' && r.ownerApproved == null) options.push({ id: 'owner', label: 'Record synthetic owner approval' });
  }
  if (record.result.decision === 'defer') {
    options.push({ id: 'refresh', label: 'Refresh synthetic source records' });
    if (!r.available) options.push({ id: 'restore', label: 'Restore sandbox dependency' });
  }
  return options;
}
export function resolveResource(record, current, type, now = Date.now()) {
  if (!resolverOptions(record).some(o => o.id === type)) throw new WorkflowError(400, 'This resolution does not apply to the decision.');
  if (current.used || record.result.resourceVersion !== current.version || record.result.policyVersion !== POLICY_VERSION) throw new WorkflowError(409, 'Evidence or policy changed. Evaluate again before resolving.');
  const resource = structuredClone(current);
  if (type === 'identity') { resource.customerVerified = true; resource.evidence.push({ id: 'identity', label: 'Customer identity', value: 'Synthetic account owner verified', reliability: 0.98, source: 'Sandbox identity resolver', verified: true }); }
  if (type === 'owner') { resource.ownerApproved = true; resource.ownerAllowedRole = 'viewer'; resource.evidence.push({ id: 'owner', label: 'Workspace owner', value: 'Synthetic owner approved viewer access', reliability: 0.98, source: 'Sandbox owner resolver', verified: true }); }
  if (type === 'restore') resource.available = true;
  if (type === 'refresh') resource.evidence = resource.evidence.map(e => ({ ...e, source: 'Sandbox source refresh', value: e.value.replace(/from yesterday|last known/gi, 'freshly checked') }));
  resource.observedAt = new Date(now).toISOString(); resource.version++;
  return resource;
}
export function reviewEvaluation(record, resource, spent, reviewerId, now = Date.now()) {
  const actor = reviewers.find(r => r.id === reviewerId);
  if (!actor || actor.domain !== record.domain) throw new WorkflowError(403, 'This sandbox actor has no review authority for this domain.');
  if (record.result.decision !== 'escalate') throw new WorkflowError(409, 'Only escalated decisions can enter operator review.');
  if (resource.used || resource.version !== record.result.resourceVersion || record.result.policyVersion !== POLICY_VERSION) throw new WorkflowError(409, 'Evidence or policy changed. Evaluate a new proposal before review.');
  const result = evaluate(record.domain, record.proposal, resource, spent, now, actor);
  if (result.decision !== 'execute') throw new WorkflowError(409, `Operator review cannot authorize this action: ${result.reasons.join(' ')}`);
  result.trace.push({ rule: 'Scoped operator review', status: 'pass', detail: `${actor.name} reviewed this exact proposal and evidence v${resource.version}.` });
  return { actor, result };
}
export function reviewedExecution(record, resource, spent, approval, now = Date.now()) {
  const ordinary = evaluate(record.domain, record.proposal, resource, spent, now);
  if (!record.reviewId) return ordinary;
  if (!approval || approval.status !== 'approved' || approval.approvedDecisionId !== record.id || approval.resourceId !== resource.id || approval.resourceVersion !== resource.version || approval.policyVersion !== POLICY_VERSION || approval.proposalJSON !== JSON.stringify(record.proposal) || Date.parse(approval.expiresAt) <= now) {
    return { ...ordinary, decision: 'refuse', reasons: ['The scoped review is revoked, expired, or no longer bound to this action and evidence.'] };
  }
  const actor = reviewers.find(r => r.id === approval.reviewerId && r.domain === record.domain);
  if (!actor) return { ...ordinary, decision: 'refuse', reasons: ['The reviewing actor no longer has domain authority.'] };
  const result = evaluate(record.domain, record.proposal, resource, spent, now, actor);
  result.trace.push({ rule: 'Scoped operator review', status: 'pass', detail: `${actor.name}; exact action, evidence version, policy and expiry rechecked.` });
  return result;
}
