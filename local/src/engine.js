import { domains } from './catalog.js';

export const POLICY_VERSION = '2026-10-13.2';
export function validateProposal(raw, domain) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Proposal must be an object.');
  const allowed = domain === 'refund' ? ['amount', 'note'] : domain === 'deploy' ? ['target', 'note'] : ['role', 'note'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('Proposal includes unsupported fields. Authority, confidence, and risk are server-derived.');
  if (typeof raw.note !== 'string' || raw.note.length > 2000) throw new Error('Request must be text, at most 2,000 characters.');
  if (domain === 'refund' && (!Number.isFinite(raw.amount) || raw.amount <= 0 || raw.amount > 100000 || Math.abs(raw.amount * 100 - Math.round(raw.amount * 100)) > 0.00001)) throw new Error('Refund amount must be positive with at most two decimal places.');
  if (domain === 'deploy' && !['staging', 'production'].includes(raw.target)) throw new Error('Choose staging or production.');
  if (domain === 'access' && !['viewer', 'editor', 'admin'].includes(raw.role)) throw new Error('Choose viewer, editor, or admin.');
  return structuredClone(raw);
}

export function evaluate(domain, proposal, resource, spent = 0, now = Date.now(), reviewedPolicy) {
  const policy = reviewedPolicy ? { ...domains[domain], ...reviewedPolicy } : domains[domain];
  if (!policy || resource.domain !== domain) throw new Error('Invalid domain or resource.');
  validateProposal(proposal, domain);
  const trace = [];
  const missing = [];
  const violations = [];
  const escalations = [];
  const waits = [];
  const add = (rule, status, detail) => trace.push({ rule, status, detail });
  if (resource.used) violations.push('This record already has a completed action.');
  if (!resource.scopeGranted) violations.push('The agent’s delegated permission has been revoked.');
  add('Delegated authority', resource.scopeGranted ? 'pass' : 'fail', `Required permission: ${policy.scope}. ${resource.scopeGranted ? 'Granted by the demo policy.' : 'Revoked.'}`);
  const requireFact = (key, label, failure) => {
    if (resource[key] === null || resource[key] === undefined) { missing.push(label); add(label, 'missing', 'Required verified evidence is missing.'); }
    else if (resource[key] !== true) { violations.push(failure); add(label, 'fail', failure); }
    else add(label, 'pass', 'Verified by the trusted record.');
  };
  if (domain === 'refund') {
    requireFact('customerVerified', 'Customer identity', 'The requester does not own this order.');
    requireFact('eligible', 'Refund eligibility', 'This order is not eligible for a refund.');
    if (proposal.amount > resource.amountMax) violations.push('The refund exceeds the captured payment.');
    if (proposal.amount > policy.amountLimit) escalations.push(`$${proposal.amount.toFixed(2)} exceeds the agent’s $${policy.amountLimit} per-action limit.`);
    if (spent + proposal.amount > policy.dailyLimit) escalations.push(`Daily total would be $${(spent + proposal.amount).toFixed(2)}; delegated limit is $${policy.dailyLimit}.`);
    add('Financial limits', proposal.amount <= policy.amountLimit && spent + proposal.amount <= policy.dailyLimit ? 'pass' : 'review', `$${spent.toFixed(2)} spent today · $${policy.dailyLimit} daily allowance · $${resource.amountMax} captured.`);
  }
  if (domain === 'deploy') {
    requireFact('testsPassed', 'Release checks', 'CI checks failed; deployment is prohibited.');
    requireFact('rollbackReady', 'Rollback readiness', 'No verified rollback artifact exists.');
    if (proposal.target === 'production' && policy.scope !== 'deploy:production') escalations.push('Production deployment requires a release operator; the agent has staging authority.');
    add('Deployment scope', proposal.target === 'staging' || policy.scope === 'deploy:production' ? 'pass' : 'review', `Requested environment: ${proposal.target}.`);
  }
  if (domain === 'access') {
    requireFact('employeeActive', 'Employee status', 'The employee is inactive; access is prohibited.');
    requireFact('ownerApproved', 'Workspace owner approval', 'The owner declined this access request.');
    if (resource.ownerApproved === true && proposal.role === 'editor' && (resource.ownerAllowedRole ?? 'viewer') !== 'editor') violations.push('The workspace owner approved viewer access only; operator review cannot expand that approval.');
    if (proposal.role === 'admin') violations.push('Administrator access is prohibited for this agent.');
    if (proposal.role === 'editor' && policy.scope !== 'access:editor') escalations.push('Editor access requires an IT operator; the agent has viewer authority.');
    add('Role scope', proposal.role === 'viewer' || proposal.role === 'editor' && policy.scope === 'access:editor' ? 'pass' : proposal.role === 'admin' ? 'fail' : 'review', `Requested role: ${proposal.role}.`);
  }
  const ageSeconds = Math.max(0, (now - Date.parse(resource.observedAt)) / 1000);
  if (!Number.isFinite(ageSeconds) || ageSeconds > policy.freshnessSeconds) waits.push(`Refresh the evidence: maximum age is ${policy.freshnessSeconds / 60} minutes.`);
  if (!resource.available) waits.push('Wait for the execution dependency to become available.');
  add('Evidence freshness', waits.some(x => x.startsWith('Refresh')) ? 'wait' : 'pass', `Record age: ${Math.round(ageSeconds)}s · limit: ${policy.freshnessSeconds}s.`);
  add('Dependency health', resource.available ? 'pass' : 'wait', resource.available ? 'Demo adapter is available.' : 'Demo adapter is offline.');
  const evidence = resource.evidence ?? [];
  if (evidence.some(e => !e.verified)) violations.push('Unverified evidence cannot authorize an action.');
  const baseConfidence = evidence.length ? Math.min(...evidence.map(e => Number.isFinite(e.reliability) && e.reliability >= 0 && e.reliability <= 1 ? e.reliability : 0)) : 0;
  const confidence = Math.max(0, Math.round((baseConfidence - missing.length * 0.25 - (ageSeconds > policy.freshnessSeconds ? 0.3 : 0)) * 100) / 100);
  if (confidence < policy.minimumConfidence && missing.length === 0 && waits.length === 0) escalations.push('Evidence confidence is below the policy’s autonomy threshold.');
  const riskFactors = [{ label: 'Domain baseline', points: domain === 'refund' ? 15 : domain === 'deploy' ? 20 : 10 }];
  if (domain === 'refund') riskFactors.push({ label: 'Financial exposure', points: Math.min(35, Math.ceil(proposal.amount / 5)) });
  if (!resource.reversible) riskFactors.push({ label: 'Irreversible effect', points: 25 });
  if (domain === 'deploy' && proposal.target === 'production') riskFactors.push({ label: 'Production blast radius', points: 40 });
  if (domain === 'access' && proposal.role !== 'viewer') riskFactors.push({ label: 'Privilege expansion', points: proposal.role === 'admin' ? 70 : 35 });
  if (missing.length) riskFactors.push({ label: 'Missing evidence', points: 20 });
  if (violations.length) riskFactors.push({ label: 'Policy violation', points: 50 });
  const risk = Math.min(100, riskFactors.reduce((sum, f) => sum + f.points, 0));
  if (risk > policy.riskLimit) escalations.push(`Risk ${risk}/100 exceeds the autonomy ceiling of ${policy.riskLimit}.`);
  add('Risk and reversibility', risk <= policy.riskLimit ? 'pass' : 'review', `${risk}/100 risk · ${resource.reversible ? 'reversible' : 'irreversible'} · autonomy ceiling ${policy.riskLimit}.`);
  add('Untrusted request boundary', 'pass', 'Request text is descriptive only. It cannot change permissions, evidence, confidence, or policy.');
  // Denials always dominate uncertainty and requests for operator review.
  const decision = violations.length ? 'refuse' : missing.length ? 'ask' : waits.length ? 'defer' : escalations.length ? 'escalate' : 'execute';
  const reasons = decision === 'refuse' ? violations : decision === 'ask' ? missing.map(x => `Provide verified ${x.toLowerCase()}.`) : decision === 'defer' ? waits : decision === 'escalate' ? escalations : ['Verified evidence and delegated authority satisfy every execution gate.'];
  return { decision, reasons, confidence, risk, riskFactors, missing, trace, evidence, reversible: resource.reversible, costOfError: domain === 'refund' ? `$${proposal.amount.toFixed(2)} of irreversible financial exposure` : domain === 'deploy' ? `${proposal.target} service disruption; rollback artifact required` : `${proposal.role} access to internal workspace records`, policyVersion: POLICY_VERSION, resourceVersion: resource.version, validUntil: new Date(Date.parse(resource.observedAt) + policy.freshnessSeconds * 1000).toISOString(), policy: { ...policy }, nextStep: { execute: 'Execute against the demo adapter. Every gate is checked again before the write.', ask: 'Collect the missing evidence and evaluate a new proposal.', defer: 'Refresh the evidence or restore the dependency, then evaluate again.', escalate: 'An authorized operator must review this action. This demo does not bypass the agent’s scope.', refuse: 'Do not execute this action. Correct the policy violation before proposing another action.' }[decision] };
}
