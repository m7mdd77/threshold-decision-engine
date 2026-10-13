import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { scenarios, buildResource } from './catalog.js';
import { evaluate, validateProposal, POLICY_VERSION } from './engine.js';
import { resolveResource, reviewEvaluation, reviewedExecution, reviewers, resolverOptions, WorkflowError } from './workflow.js';

export class AppError extends Error { constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; } }
const hash = value => createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sandboxes(id TEXT PRIMARY KEY, csrf TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, sandbox TEXT NOT NULL REFERENCES sandboxes(id), snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, sandbox TEXT NOT NULL REFERENCES sandboxes(id), record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects(decision TEXT PRIMARY KEY REFERENCES decisions(id), sandbox TEXT NOT NULL REFERENCES sandboxes(id), resource TEXT UNIQUE NOT NULL, domain TEXT NOT NULL, amount REAL NOT NULL, created TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, sandbox TEXT NOT NULL REFERENCES sandboxes(id), payload TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, sandbox TEXT NOT NULL REFERENCES sandboxes(id), record TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createSandbox() {
    const sandbox = { id: randomUUID(), csrf: randomUUID() };
    this.db.prepare('INSERT INTO sandboxes VALUES (?, ?)').run(sandbox.id, sandbox.csrf);
    return sandbox;
  }
  sandbox(id) { return this.db.prepare('SELECT * FROM sandboxes WHERE id=?').get(id); }
  event(sandbox, type, data) {
    const previous = this.db.prepare('SELECT hash FROM audit WHERE sandbox=? ORDER BY id DESC LIMIT 1').get(sandbox)?.hash ?? 'GENESIS';
    const payload = JSON.stringify({ type, at: new Date().toISOString(), data });
    const digest = hash(previous + '\n' + payload);
    const info = this.db.prepare('INSERT INTO audit(sandbox,payload,previous,hash) VALUES (?,?,?,?)').run(sandbox, payload, previous, digest);
    return { id: Number(info.lastInsertRowid), payload: JSON.parse(payload), previous, hash: digest };
  }
  spent(sandbox, now = Date.now()) {
    return this.db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM effects WHERE sandbox=? AND domain='refund' AND substr(created,1,10)=?").get(sandbox, new Date(now).toISOString().slice(0,10)).amount;
  }
  resource(sandbox, id) {
    const row = this.db.prepare('SELECT snapshot FROM resources WHERE id=? AND sandbox=?').get(id, sandbox);
    if (!row) throw new AppError(404, 'Run not found in this sandbox.');
    return JSON.parse(row.snapshot);
  }
  decision(sandbox, id) {
    const row = this.db.prepare('SELECT record FROM decisions WHERE id=? AND sandbox=?').get(id, sandbox);
    if (!row) throw new AppError(404, 'Decision not found in this sandbox.');
    return JSON.parse(row.record);
  }
  saveResource(sandbox, resource) { this.db.prepare('UPDATE resources SET snapshot=? WHERE id=? AND sandbox=?').run(JSON.stringify(resource), resource.id, sandbox); }
  createRun(sandbox, scenarioId) {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) throw new AppError(400, 'Unknown scenario.');
    return this.transaction(() => {
      const resource = { ...buildResource(scenario), id: randomUUID(), scenarioId };
      this.db.prepare('INSERT INTO resources VALUES (?,?,?)').run(resource.id, sandbox, JSON.stringify(resource));
      this.event(sandbox, 'run.created', { resourceId: resource.id, scenarioId, domain: scenario.domain });
      return { resource, proposal: scenario.proposal };
    });
  }
  evaluateRun(sandbox, resourceId, raw, agentContext) {
    return this.transaction(() => {
      const resource = this.resource(sandbox, resourceId);
      let proposal;
      try { proposal = validateProposal(raw, resource.domain); } catch (error) { throw new AppError(400, error.message); }
      const result = evaluate(resource.domain, proposal, resource, this.spent(sandbox));
      return this.writeDecision(sandbox, resource, proposal, result, agentContext);
    });
  }
  writeDecision(sandbox, resource, proposal, result, agentContext, extra = {}) {
    const record = { id: randomUUID(), at: new Date().toISOString(), domain: resource.domain, resourceId: resource.id, proposal, resourceSnapshot: structuredClone(resource), result, ...extra };
    record.resolutionOptions = resolverOptions(record);
    if (agentContext) record.agent = agentContext;
    this.db.prepare('INSERT INTO decisions VALUES (?,?,?)').run(record.id, sandbox, JSON.stringify(record));
    this.event(sandbox, 'decision.evaluated', record);
    if (result.decision === 'escalate') {
      const review = { id: randomUUID(), originalDecisionId: record.id, resourceId: resource.id, resourceVersion: resource.version, domain: resource.domain, status: 'pending', createdAt: record.at };
      this.db.prepare('INSERT INTO reviews VALUES (?,?,?)').run(review.id, sandbox, JSON.stringify(review));
      this.event(sandbox, 'review.requested', review);
    }
    return record;
  }
  review(sandbox, id) {
    const row = this.db.prepare('SELECT record FROM reviews WHERE id=? AND sandbox=?').get(id, sandbox);
    if (!row) throw new AppError(404, 'Review not found in this sandbox.');
    return JSON.parse(row.record);
  }
  saveReview(sandbox, review) { this.db.prepare('UPDATE reviews SET record=? WHERE id=? AND sandbox=?').run(JSON.stringify(review), review.id, sandbox); }
  resolveEvidence(sandbox, decisionId, type) {
    return this.transaction(() => {
      const record = this.decision(sandbox, decisionId);
      const resource = resolveResource(record, this.resource(sandbox, record.resourceId), type);
      this.saveResource(sandbox, resource);
      this.event(sandbox, 'evidence.resolved', { decisionId, resourceId: resource.id, type, version: resource.version, source: 'Synthetic sandbox resolver' });
      return this.writeDecision(sandbox, resource, record.proposal, evaluate(record.domain, record.proposal, resource, this.spent(sandbox)), record.agent, { sourceDecisionId: record.id });
    });
  }
  reviewDecision(sandbox, reviewId, reviewerId, verdict, note) {
    if (!['approve', 'deny'].includes(verdict) || typeof note !== 'string' || note.trim().length < 5 || note.length > 600) throw new WorkflowError(400, 'Choose approve or deny and provide a review reason (5–600 characters).');
    return this.transaction(() => {
      const review = this.review(sandbox, reviewId), record = this.decision(sandbox, review.originalDecisionId);
      const actor = reviewers.find(r => r.id === reviewerId && r.domain === record.domain);
      if (!actor) throw new WorkflowError(403, 'This sandbox actor has no review authority for this domain.');
      if (review.status !== 'pending') throw new WorkflowError(409, 'This review is already resolved.');
      const now = Date.now();
      let next;
      if (verdict === 'approve') {
        const resource = this.resource(sandbox, record.resourceId);
        const { result } = reviewEvaluation(record, resource, this.spent(sandbox), reviewerId, now);
        next = this.writeDecision(sandbox, resource, record.proposal, result, record.agent, { reviewId, sourceDecisionId: record.id });
        Object.assign(review, { approvedDecisionId: next.id, proposalJSON: JSON.stringify(record.proposal), policyVersion: POLICY_VERSION, expiresAt: new Date(Math.min(now + 600000, Date.parse(result.validUntil))).toISOString() });
      }
      Object.assign(review, { status: verdict === 'approve' ? 'approved' : 'denied', reviewerId, reviewerName: actor.name, note: note.trim(), reviewedAt: new Date(now).toISOString() });
      this.saveReview(sandbox, review); this.event(sandbox, verdict === 'approve' ? 'review.approved' : 'review.denied', review);
      return { review, record: next };
    });
  }
  revokeReview(sandbox, reviewId, reviewerId) {
    return this.transaction(() => {
      const review = this.review(sandbox, reviewId);
      if (review.status !== 'approved' || review.reviewerId !== reviewerId) throw new WorkflowError(403, 'Only the original sandbox reviewer can revoke an active approval.');
      review.status = 'revoked'; review.revokedAt = new Date().toISOString();
      this.saveReview(sandbox, review); this.event(sandbox, 'review.revoked', review); return review;
    });
  }
  execute(sandbox, decisionId) {
    return this.transaction(() => {
      const record = this.decision(sandbox, decisionId);
      const existing = this.db.prepare('SELECT result FROM effects WHERE decision=? AND sandbox=?').get(decisionId, sandbox);
      if (existing) return { status: 200, replay: true, effect: JSON.parse(existing.result) };
      const resource = this.resource(sandbox, record.resourceId);
      const fresh = reviewedExecution(record, resource, this.spent(sandbox), record.reviewId ? this.review(sandbox, record.reviewId) : undefined);
      if (record.result.decision !== 'execute' || fresh.decision !== 'execute' || record.result.resourceVersion !== resource.version || record.result.policyVersion !== POLICY_VERSION) {
        const reason = record.result.decision !== 'execute' ? `Original decision was ${record.result.decision}; it does not authorize execution.` : fresh.decision !== 'execute' ? fresh.reasons.join(' ') : 'The resource changed after evaluation. A new decision is required.';
        const blocked = { decisionId, reason, currentDecision: fresh.decision, originalVersion: record.result.resourceVersion, currentVersion: resource.version, result: fresh };
        this.event(sandbox, 'execution.blocked', blocked);
        return { status: 409, blocked };
      }
      const effect = { id: randomUUID(), decisionId, at: new Date().toISOString(), domain: record.domain, description: record.domain === 'refund' ? `Issued a $${record.proposal.amount.toFixed(2)} sandbox refund.` : record.domain === 'deploy' ? `Set the sandbox ${record.proposal.target} release to v2.4.1.` : `Granted ${record.proposal.role} access in the sandbox workspace.`, state: record.domain === 'refund' ? { refunded: record.proposal.amount, order: 'ORD-2048' } : record.domain === 'deploy' ? { environment: record.proposal.target, release: 'v2.4.1', rollback: 'v2.4.0' } : { employee: 'Sam', role: record.proposal.role }, reversible: resource.reversible };
      this.db.prepare('INSERT INTO effects VALUES (?,?,?,?,?,?,?)').run(decisionId, sandbox, resource.id, record.domain, record.proposal.amount ?? 0, effect.at, JSON.stringify(effect));
      resource.used = true; resource.version += 1;
      this.saveResource(sandbox, resource);
      this.event(sandbox, 'action.executed', effect);
      return { status: 200, replay: false, effect };
    });
  }
  fault(sandbox, id, type) {
    if (!['revoke', 'stale', 'offline', 'ci-failed'].includes(type)) throw new AppError(400, 'Unknown fault.');
    return this.transaction(() => {
      const resource = this.resource(sandbox, id);
      if (type === 'revoke') resource.scopeGranted = false;
      if (type === 'stale') resource.observedAt = new Date(Date.now() - 172800000).toISOString();
      if (type === 'offline') resource.available = false;
      if (type === 'ci-failed') {
        if (resource.domain !== 'deploy') throw new AppError(400, 'CI failure applies only to deployment runs.');
        resource.testsPassed = false;
        resource.evidence = resource.evidence.map(e => e.id === 'ci' ? { ...e, value: 'Checks failed after approval' } : e);
      }
      resource.version += 1;
      this.saveResource(sandbox, resource);
      this.event(sandbox, 'evidence.changed', { resourceId: id, type, version: resource.version });
      return resource;
    });
  }
  audit(sandbox) {
    return this.db.prepare('SELECT * FROM audit WHERE sandbox=? ORDER BY id').all(sandbox).map(row => ({ id: row.id, payload: JSON.parse(row.payload), previous: row.previous, hash: row.hash }));
  }
  verify(sandbox) {
    const rows = this.db.prepare('SELECT * FROM audit WHERE sandbox=? ORDER BY id').all(sandbox);
    let previous = 'GENESIS';
    for (const row of rows) { if (row.previous !== previous || row.hash !== hash(previous + '\n' + row.payload)) return { valid: false, brokenAt: row.id, count: rows.length }; previous = row.hash; }
    return { valid: true, count: rows.length, head: previous };
  }
  state(sandbox) {
    const decisions = this.db.prepare('SELECT record FROM decisions WHERE sandbox=? ORDER BY rowid DESC').all(sandbox).map(row => JSON.parse(row.record));
    const effects = this.db.prepare('SELECT result FROM effects WHERE sandbox=? ORDER BY rowid DESC').all(sandbox).map(row => JSON.parse(row.result));
    const reviews = this.db.prepare('SELECT record FROM reviews WHERE sandbox=? ORDER BY rowid DESC').all(sandbox).map(row => JSON.parse(row.record));
    return { decisions, effects, reviews, reviewers, spent: this.spent(sandbox), integrity: this.verify(sandbox) };
  }
}
