import assert from 'node:assert/strict';
const base=process.argv[2]??'http://127.0.0.1:3242';
let cookie='',csrf='',checks=0;
async function call(path,input,extra={}){
 const res=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,...(input===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},body:input===undefined?undefined:JSON.stringify(input)});
 const body=await res.text();let data;try{data=JSON.parse(body);}catch{data={error:body.slice(0,300)};}return{status:res.status,data,headers:res.headers};
}
function check(condition,message){assert.ok(condition,message);checks++;}
const start=await call('/api/state');check(start.status===200,'State reachable anonymously');cookie=start.headers.get('set-cookie')?.split(';')[0]??'';csrf=start.data.csrf;
check(start.data.publicDemo&&start.data.agent.configured===false,'Public demo has no paid model access');
async function decide(id,proposal){const run=await call('/api/runs',{scenarioId:id});check(run.status===201,`Run ${id}`);const d=await call('/api/evaluate',{resourceId:run.data.resource.id,proposal:proposal??run.data.proposal});check(d.status===200,`Evaluate ${id}`);return{run:run.data,record:d.data};}
for(const [id,outcome] of [['refund-safe','execute'],['refund-missing','ask'],['refund-large','escalate'],['refund-injection','refuse'],['deploy-safe','execute'],['deploy-stale','defer'],['deploy-prod','escalate'],['deploy-failed','refuse'],['access-safe','execute'],['access-missing','ask'],['access-admin','refuse'],['access-offline','defer'],['access-editor','escalate']])check((await decide(id)).record.result.decision===outcome,`${id} outcome`);
const missing=await decide('refund-missing');const resolved=await call('/api/resolve',{decisionId:missing.record.id,type:'identity'});check(resolved.status===200&&resolved.data.result.decision==='execute','Ask resolved');check((await call('/api/execute',{decisionId:missing.record.id})).status===409,'Original Ask cannot execute');
const receipts=await Promise.all(Array.from({length:4},()=>call('/api/execute',{decisionId:resolved.data.id})));check(receipts.every(r=>r.status===200),'Concurrent refund replay responses');check(receipts.filter(r=>!r.data.replay).length===1,'Single synthetic write');check(new Set(receipts.map(r=>r.data.effect.id)).size===1,'Same receipt for every replay');
const stale=await decide('deploy-stale');check((await call('/api/resolve',{decisionId:stale.record.id,type:'refresh'})).data.result.decision==='execute','Defer resolved');
const prod=await decide('deploy-prod');let state=(await call('/api/state')).data;const review=state.reviews.find(r=>r.originalDecisionId===prod.record.id);
check((await call('/api/review',{reviewId:review.id,reviewerId:'observer',verdict:'approve',note:'Please approve the release.'})).status===403,'Observer cannot approve');
check((await call('/api/review',{reviewId:review.id,reviewerId:'noor',verdict:'approve',note:'Healthy synthetic release, verified rollback and bounded risk.',riskLimit:100})).status===400,'Forged review authority rejected');
const approved=await call('/api/review',{reviewId:review.id,reviewerId:'noor',verdict:'approve',note:'Healthy synthetic release, verified rollback and bounded risk.'});check(approved.status===200&&approved.data.record.result.decision==='execute','Scoped operator approval');
await call('/api/review/revoke',{reviewId:review.id,reviewerId:'noor'});check((await call('/api/execute',{decisionId:approved.data.record.id})).status===409,'Revoked approval blocked');
const failure=await decide('deploy-safe');await call('/api/fault',{resourceId:failure.run.resource.id,type:'ci-failed'});const blocked=await call('/api/execute',{decisionId:failure.record.id});check(blocked.status===409&&blocked.data.blocked.currentDecision==='refuse','Changed CI contained');
check((await call('/api/resolve',{decisionId:failure.record.id,type:'refresh'})).status===400,'Resolution cannot override executed/refused policy');
check((await call('/api/runs',{scenarioId:'refund-safe'},{'X-CSRF-Token':''})).status===403,'CSRF enforced');const originAttempt=await call('/api/runs',{scenarioId:'refund-safe'},{Origin:'https://evil.example'});check(originAttempt.status===403||base.startsWith('http://127.0.0.1:')&&originAttempt.status===503,'Origin enforced (Wrangler may reject before the handler)');
const audit=await call('/api/audit');check(audit.status===200&&audit.data.integrity.valid,'Persistent audit chain valid');check(audit.data.events.some(e=>e.payload.type==='review.revoked'),'Review events persisted');
const final=(await call('/api/state')).data;check(final.effects.length===1,'Only intended sandbox write');
const originalCookie=cookie,originalCsrf=csrf;cookie='';const other=await call('/api/state');cookie=other.headers.get('set-cookie').split(';')[0];csrf=other.data.csrf;check((await call('/api/execute',{decisionId:resolved.data.id})).status===404,'Cross-session decision access rejected');cookie=originalCookie;csrf=originalCsrf;
check((await call('/api/agent/propose',{resourceId:prod.run.resource.id,request:'Deploy production.'})).status===503,'No public paid inference');
console.log(JSON.stringify({base,checks,decisions:final.decisions.length,effects:final.effects.length,auditEvents:audit.data.events.length,integrity:true}));
