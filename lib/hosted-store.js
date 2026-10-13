import { scenarios, buildResource } from './catalog.js';
import { evaluate, validateProposal, POLICY_VERSION } from './engine.js';
import { resolveResource, reviewEvaluation, reviewedExecution, reviewers, resolverOptions, WorkflowError } from './workflow.js';

const uuid = () => crypto.randomUUID();
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
export const newSandbox = () => ({ id: uuid(), csrf: uuid(), resources: {}, decisions: [], effects: [], reviews: [], events: [] });
// One sandbox is committed atomically with D1 compare-and-swap in the route.
// No external effects occur inside this store. Replays return the saved receipt.
export class HostedStore {
  constructor(data) { this.data = data; }
  fail(status, message) { throw new WorkflowError(status, message); }
  event(type, data) {
    if (this.data.events.length >= 450) this.fail(429, 'This sandbox reached its audit quota. Start a fresh sandbox.');
    this.data.events.push({ id: this.data.events.length + 1, payload: { type, at: new Date().toISOString(), data: structuredClone(data) } });
  }
  async seal() {
    let previous = 'GENESIS';
    for (const event of this.data.events) {
      if (!event.hash) { event.previous = previous; event.hash = await digest(previous + '\n' + JSON.stringify(event.payload)); }
      previous = event.hash;
    }
  }
  async verify() {
    let previous = 'GENESIS';
    for (const event of this.data.events) {
      if (event.previous !== previous || event.hash !== await digest(previous + '\n' + JSON.stringify(event.payload))) return { valid: false, brokenAt: event.id, count: this.data.events.length };
      previous = event.hash;
    }
    return { valid: true, count: this.data.events.length, head: previous };
  }
  spent() { const day = new Date().toISOString().slice(0,10); return this.data.effects.filter(e => e.domain === 'refund' && e.at.startsWith(day)).reduce((sum,e) => sum + e.state.refunded,0); }
  resource(id) { if (!Object.hasOwn(this.data.resources,id)) this.fail(404, 'Run not found in this sandbox.'); return this.data.resources[id]; }
  decision(id) { const value = this.data.decisions.find(r => r.id === id); if (!value) this.fail(404, 'Decision not found in this sandbox.'); return value; }
  review(id) { const value = this.data.reviews.find(r => r.id === id); if (!value) this.fail(404, 'Review not found in this sandbox.'); return value; }
  createRun(id) {
    const scenario = scenarios.find(s => s.id === id); if (!scenario) this.fail(400,'Unknown scenario.');
    if (Object.keys(this.data.resources).length >= 60) this.fail(429,'Run quota reached. Start a fresh sandbox.');
    const resource = {...buildResource(scenario),id:uuid(),scenarioId:id}; this.data.resources[resource.id] = resource;
    this.event('run.created',{resourceId:resource.id,scenarioId:id,domain:scenario.domain}); return {resource,proposal:scenario.proposal};
  }
  writeDecision(resource,proposal,result,extra={}) {
    if (this.data.decisions.length >= 100) this.fail(429,'Decision quota reached. Start a fresh sandbox.');
    const record = {id:uuid(),at:new Date().toISOString(),domain:resource.domain,resourceId:resource.id,proposal:structuredClone(proposal),resourceSnapshot:structuredClone(resource),result,...extra};
    record.resolutionOptions = resolverOptions(record); this.data.decisions.push(record); this.event('decision.evaluated',record);
    if(result.decision==='escalate') {
      const review={id:uuid(),originalDecisionId:record.id,resourceId:resource.id,resourceVersion:resource.version,domain:resource.domain,status:'pending',createdAt:record.at}; this.data.reviews.push(review);this.event('review.requested',review);
    }
    return record;
  }
  evaluateRun(resourceId, raw) { const resource = this.resource(resourceId); let proposal;try{proposal=validateProposal(raw,resource.domain);}catch(e){this.fail(400,e.message);}return this.writeDecision(resource,proposal,evaluate(resource.domain,proposal,resource,this.spent())); }
  resolveEvidence(decisionId,type) {
    const record=this.decision(decisionId),resource=resolveResource(record,this.resource(record.resourceId),type);this.data.resources[resource.id]=resource;
    this.event('evidence.resolved',{decisionId,resourceId:resource.id,type,version:resource.version,source:'Synthetic sandbox resolver'});
    return this.writeDecision(resource,record.proposal,evaluate(resource.domain,record.proposal,resource,this.spent()),{sourceDecisionId:record.id});
  }
  reviewDecision(reviewId,reviewerId,verdict,note) {
    if(!['approve','deny'].includes(verdict)||typeof note!=='string'||note.trim().length<5||note.length>600)this.fail(400,'Choose approve or deny and provide a review reason (5–600 characters).');
    const review=this.review(reviewId),record=this.decision(review.originalDecisionId),actor=reviewers.find(r=>r.id===reviewerId&&r.domain===record.domain);
    if(!actor)this.fail(403,'This sandbox actor has no review authority for this domain.');if(review.status!=='pending')this.fail(409,'This review is already resolved.');
    const now=Date.now();let next;
    if(verdict==='approve') {
      const resource=this.resource(record.resourceId),{result}=reviewEvaluation(record,resource,this.spent(),reviewerId,now);
      next=this.writeDecision(resource,record.proposal,result,{reviewId,sourceDecisionId:record.id});
      Object.assign(review,{approvedDecisionId:next.id,proposalJSON:JSON.stringify(record.proposal),policyVersion:POLICY_VERSION,expiresAt:new Date(Math.min(now+600000,Date.parse(result.validUntil))).toISOString()});
    }
    Object.assign(review,{status:verdict==='approve'?'approved':'denied',reviewerId,reviewerName:actor.name,note:note.trim(),reviewedAt:new Date(now).toISOString()});
    this.event(verdict==='approve'?'review.approved':'review.denied',review);return{review,record:next};
  }
  revokeReview(id,actor) {const review=this.review(id);if(review.status!=='approved'||review.reviewerId!==actor)this.fail(403,'Only the original sandbox reviewer can revoke an active approval.');review.status='revoked';review.revokedAt=new Date().toISOString();this.event('review.revoked',review);return review;}
  execute(id) {
    const record=this.decision(id),existing=this.data.effects.find(e=>e.decisionId===id);if(existing)return{status:200,replay:true,effect:existing};
    const resource=this.resource(record.resourceId),fresh=reviewedExecution(record,resource,this.spent(),record.reviewId?this.review(record.reviewId):undefined);
    if(record.result.decision!=='execute'||fresh.decision!=='execute'||record.result.resourceVersion!==resource.version||record.result.policyVersion!==POLICY_VERSION) {
      const reason=record.result.decision!=='execute'?`Original decision was ${record.result.decision}; it does not authorize execution.`:fresh.decision!=='execute'?fresh.reasons.join(' '):'The resource or policy changed after evaluation. A new decision is required.';
      const blocked={decisionId:id,reason,currentDecision:fresh.decision,originalVersion:record.result.resourceVersion,currentVersion:resource.version,result:fresh};this.event('execution.blocked',blocked);return{status:409,blocked};
    }
    const effect={id:uuid(),decisionId:id,at:new Date().toISOString(),domain:record.domain,description:record.domain==='refund'?`Issued a $${record.proposal.amount.toFixed(2)} sandbox refund.`:record.domain==='deploy'?`Set the sandbox ${record.proposal.target} release to v2.4.1.`:`Granted ${record.proposal.role} access in the sandbox workspace.`,state:record.domain==='refund'?{refunded:record.proposal.amount,order:'ORD-2048'}:record.domain==='deploy'?{environment:record.proposal.target,release:'v2.4.1',rollback:'v2.4.0'}:{employee:'Sam',role:record.proposal.role},reversible:resource.reversible};
    this.data.effects.push(effect);resource.used=true;resource.version++;this.event('action.executed',effect);return{status:200,replay:false,effect};
  }
  fault(id,type) {
    if(!['revoke','stale','offline','ci-failed'].includes(type))this.fail(400,'Unknown fault.');const resource=this.resource(id);
    if(type==='revoke')resource.scopeGranted=false;if(type==='stale')resource.observedAt=new Date(Date.now()-172800000).toISOString();if(type==='offline')resource.available=false;
    if(type==='ci-failed'){if(resource.domain!=='deploy')this.fail(400,'CI failure applies only to deployment runs.');resource.testsPassed=false;resource.evidence=resource.evidence.map(e=>e.id==='ci'?{...e,value:'Checks failed after approval'}:e);}
    resource.version++;this.event('evidence.changed',{resourceId:id,type,version:resource.version});return resource;
  }
  async state() {return{decisions:[...this.data.decisions].reverse(),effects:this.data.effects,reviews:[...this.data.reviews].reverse(),reviewers,spent:this.spent(),integrity:await this.verify()};}
}
