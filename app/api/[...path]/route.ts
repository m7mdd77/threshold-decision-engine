import { env } from 'cloudflare:workers';
import { HostedStore, newSandbox } from '../../../lib/hosted-store.js';
import { domains, scenarios } from '../../../lib/catalog.js';
import { POLICY_VERSION } from '../../../lib/engine.js';
import { validateFields, WorkflowError } from '../../../lib/workflow.js';

export const dynamic = 'force-dynamic';
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(data:any,status=200,cookie?:string)=>new Response(JSON.stringify(data),{status,headers:{...headers,...(cookie?{'Set-Cookie':cookie}:{})}});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function limit(db:D1Database,key:string,max:number,expires:number) {
  const row=await db.prepare('INSERT INTO demo_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,expires).first<{count:number}>();
  if(!row||row.count>max)throw new WorkflowError(429,'Public demo rate limit reached. Try again later.');
}
async function readBody(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new WorkflowError(415,'Use application/json.');
  const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
  if(!reader)throw new WorkflowError(400,'Request body is missing.');
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>16384){await reader.cancel();throw new WorkflowError(413,'Request is too large.');}text+=decoder.decode(item.value,{stream:true});}text+=decoder.decode();
  try{return JSON.parse(text);}catch{throw new WorkflowError(400,'Invalid JSON.');}
}
async function handle(request:Request) {
  try {
    const db=env.DB;if(!db)throw new WorkflowError(503,'Sandbox storage is temporarily unavailable.');
    const url=new URL(request.url),path=url.pathname;
    if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new WorkflowError(403,'Cross-origin requests are not allowed.');
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10),hour=Math.floor(now/3600000);
    const ip=await hash(request.headers.get('cf-connecting-ip')??'local-preview');
    const raw=/\bthreshold=([^;]+)/.exec(request.headers.get('cookie')??'')?.[1];
    let row=raw?await db.prepare('SELECT payload,revision FROM demo_sandboxes WHERE id=? AND expires>?').bind(raw,now).first<{payload:string,revision:number}>():null;
    let cookie:string|undefined;
    async function create() {
      await limit(db!,`new-ip:${hour}:${ip}`,20,(hour+2)*3600000);await limit(db!,`new-global:${day}`,500,now+172800000);
      const data=newSandbox();await db!.prepare('INSERT INTO demo_sandboxes(id,payload,revision,expires) VALUES (?,?,0,?)').bind(data.id,JSON.stringify(data),now+7*86400000).run();
      cookie=`threshold=${data.id}; Path=/; HttpOnly; SameSite=Strict${url.protocol==='https:'?'; Secure':''}`;row={payload:JSON.stringify(data),revision:0};
      // Bounded indexed retention cleanup; these are anonymous synthetic sessions.
      await db!.prepare('DELETE FROM demo_limits WHERE key IN (SELECT key FROM demo_limits WHERE expires<? LIMIT 25)').bind(now).run();
      await db!.prepare('DELETE FROM demo_sandboxes WHERE id IN (SELECT id FROM demo_sandboxes WHERE expires<? LIMIT 10)').bind(now).run();
    }
    if(!row&&request.method==='GET'&&path==='/api/state')await create();
    if(!row)throw new WorkflowError(401,'Open the decision lab to start a sandbox.');
    const data=JSON.parse(row.payload),store=new HostedStore(data);
    if(request.method==='GET'&&path==='/api/state')return reply({...await store.state(),csrf:data.csrf,policyVersion:POLICY_VERSION,domains,scenarios:scenarios.map(({facts,...scenario})=>scenario),publicDemo:true,agent:{configured:false,model:'gpt-6.1-sol',provider:'AgentRouter',message:'Paid inference is available only in the local build.'}},200,cookie);
    if(request.method==='GET'&&path==='/api/audit')return reply({events:data.events,integrity:await store.verify()});
    if(request.method!=='POST')throw new WorkflowError(405,'Method not allowed.');
    if(request.headers.get('x-csrf-token')!==data.csrf)throw new WorkflowError(403,'Reload the lab before making a change.');
    await limit(db,`post:${hour}:${data.id}`,120,(hour+2)*3600000);
    const input=await readBody(request);validateFields(input,Object.keys(input??{}));
    if(path==='/api/agent/propose')throw new WorkflowError(503,'Paid inference is local only. Use structured proposals in this public sandbox.');
    if(path==='/api/new-sandbox'){validateFields(input,[]);await create();return reply({message:'Fresh public sandbox created.'},201,cookie);}
    let result:any,status=200;
    // Optimistic version check serializes concurrent budget, evidence and writes.
    for(let attempt=0;attempt<3;attempt++) {
      const current=attempt===0?row:await db.prepare('SELECT payload,revision FROM demo_sandboxes WHERE id=? AND expires>?').bind(data.id,now).first<{payload:string,revision:number}>();
      if(!current)throw new WorkflowError(401,'This sandbox expired. Reload to start again.');
      const working=new HostedStore(JSON.parse(current.payload));
      if(path==='/api/runs'){validateFields(input,['scenarioId']);result=working.createRun(input.scenarioId);status=201;}
      else if(path==='/api/evaluate'){validateFields(input,['resourceId','proposal']);result=working.evaluateRun(input.resourceId,input.proposal);}
      else if(path==='/api/resolve'){validateFields(input,['decisionId','type']);result=working.resolveEvidence(input.decisionId,input.type);}
      else if(path==='/api/review'){validateFields(input,['reviewId','reviewerId','verdict','note']);result=working.reviewDecision(input.reviewId,input.reviewerId,input.verdict,input.note);}
      else if(path==='/api/review/revoke'){validateFields(input,['reviewId','reviewerId']);result=working.revokeReview(input.reviewId,input.reviewerId);}
      else if(path==='/api/execute'){validateFields(input,['decisionId']);result=working.execute(input.decisionId);status=result.status;}
      else if(path==='/api/fault'){validateFields(input,['resourceId','type']);result=working.fault(input.resourceId,input.type);}
      else throw new WorkflowError(404,'Route not found.');
      if(path==='/api/execute'&&result.replay)return reply(result,status);
      await working.seal();const payload=JSON.stringify(working.data);
      if(payload.length>1500000)throw new WorkflowError(429,'Sandbox storage quota reached. Start a fresh sandbox.');
      const changed=await db.prepare('UPDATE demo_sandboxes SET payload=?,revision=revision+1 WHERE id=? AND revision=? AND expires>?').bind(payload,data.id,current.revision,now).run();
      if(changed.meta.changes===1)return reply(result,status);
    }
    throw new WorkflowError(409,'Concurrent evidence or budget update. Retry the action.');
  } catch(error:any) {return reply({error:error instanceof WorkflowError?error.message:'Unexpected server error; no action was confirmed.'},error instanceof WorkflowError?error.status:500);}
}
export const GET=handle;export const POST=handle;
