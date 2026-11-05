import {readFileSync} from 'node:fs';
import {AgentError} from './agent-error.js';

export const CEREBRAS_MODEL='qwen-3.8-27b';
const BASE='https://api.cerebras.ai/v1';
const KEY=/^csk-[A-Za-z0-9_-]{15,}$/;
const number=value=>Number.isSafeInteger(value)&&value>=0?value:0;

function approvedBase(value){
 let url;try{url=new URL(value);}catch{throw new AgentError(503,'invalid_configuration','Use the approved Cerebras HTTPS endpoint.');}
 if(url.origin!=='https://api.cerebras.ai'||!['/v1','/v1/'].includes(url.pathname)||url.username||url.password||url.search||url.hash)throw new AgentError(503,'invalid_configuration','Use the approved Cerebras HTTPS endpoint.');
 return BASE;
}
export function cerebrasConfig(env=process.env){
 const endpoint=approvedBase(env.CEREBRAS_BASE_URL||BASE),model=env.CEREBRAS_MODEL||CEREBRAS_MODEL;
 if(model!==CEREBRAS_MODEL)throw new AgentError(503,'invalid_configuration','Use the approved Cerebras model.');
 let key=(env.CEREBRAS_API_KEY||'').trim();
 if(!key&&env.CEREBRAS_KEY_FILE){try{key=readFileSync(env.CEREBRAS_KEY_FILE,'utf8').trim();}catch{throw new AgentError(503,'invalid_configuration','The Cerebras key file could not be read.');}}
 if(key&&!KEY.test(key))throw new AgentError(503,'invalid_configuration','The Cerebras key file or environment value is invalid.');
 return {provider:'Cerebras',endpoint,model,key,configured:Boolean(key),format:'openai',transport:'cerebras'};
}

async function boundedJson(response){
 if(!response.body)throw Error('body');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('size');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function retryDelay(value){
 if(!value)return undefined;
 const seconds=Number(value),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now();
 return Number.isFinite(delay)&&delay>=0?Math.min(3600000,Math.ceil(delay)):undefined;
}

// No subprocess, tools, saved answer, provider fallback, or automatic retry.
// Only validated text proposals leave this boundary; the app owns every effect.
export async function invokeCerebras({config,messages,signal,fetchImpl=fetch,maxTokens=2048,jsonMode=true}){
 approvedBase(config.endpoint||BASE);
 if(config.model!==CEREBRAS_MODEL||!KEY.test(config.key||''))throw new AgentError(503,'not_configured','Configure the approved Cerebras key and model.');
 if(!Array.isArray(messages)||!messages.length||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(messages).length>64000)throw new AgentError(400,'invalid_request','The AI request is invalid or too large.');
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>4096)throw new AgentError(503,'invalid_configuration','The completion bound is invalid.');
 let usage={};
 const fail=(code,message,providerFailure='unknown',status=502,extra={})=>Object.assign(new AgentError(status,code,message),{providerFailure,inputTokens:usage.input_tokens||0,outputTokens:usage.output_tokens||0,cacheReadTokens:usage.cache_read_input_tokens||0,estimatedCostUsd:null,...extra});
 const abort=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(90000)]);
 try{
  abort.throwIfAborted();
  const response=await fetchImpl(BASE+'/chat/completions',{method:'POST',redirect:'error',signal:abort,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({model:config.model,messages,max_completion_tokens:maxTokens,reasoning_effort:'none',temperature:0.2,stream:false,...(jsonMode?{response_format:{type:'json_object'}}:{})})});
  if(!response.ok){
   const delay=retryDelay(response.headers.get('retry-after'));await response.body?.cancel().catch(()=>{});
   if(response.status===429)throw fail('client_request_failed','Cerebras is rate-limiting requests. No automatic retry was made.','rate_limit',429,{retryAfterMs:delay});
   if([401,403].includes(response.status))throw fail('client_request_failed','Cerebras rejected the configured key or model access.','authentication');
   if(response.status===402)throw fail('client_request_failed','The Cerebras allowance is unavailable.','quota');
   throw fail('client_request_failed','Cerebras could not complete this reading. No automatic retry was made.');
  }
  let data;try{data=await boundedJson(response);}catch{throw fail('invalid_output','Cerebras returned an unreadable or oversized response.');}
  const u=data.usage||{},cached=Math.min(number(u.prompt_tokens),number(u.prompt_tokens_details?.cached_tokens));
  usage={input_tokens:number(u.prompt_tokens)-cached,output_tokens:number(u.completion_tokens),cache_read_input_tokens:cached};
  const choice=data.choices?.[0],message=choice?.message;
  if(choice?.finish_reason==='content_filter')throw fail('client_request_failed','Cerebras declined this reading.','content_filter');
  if(data.model!==config.model||data.choices?.length!==1||choice?.finish_reason!=='stop'||message?.tool_calls?.length||message?.function_call||typeof message?.content!=='string'||!message.content.trim()||message.content.includes(config.key))throw fail('invalid_output','Cerebras did not return a complete text-only proposal.');
  if(jsonMode){try{const result=JSON.parse(message.content);if(!result||typeof result!=='object'||Array.isArray(result))throw Error();}catch{throw fail('invalid_output','Cerebras did not return a JSON object.');}}
  return {provider:'Cerebras',model:data.model,stop_reason:'end_turn',content:[{type:'text',text:message.content}],usage,estimatedCostUsd:null};
 }catch(error){
  if(abort.aborted)throw fail('provider_timeout','The Cerebras reading timed out. No action was authorized.','timeout');
  if(error instanceof AgentError)throw error;
  throw fail('client_request_failed','Cerebras could not be reached. No automatic retry was made.','connection');
 }
}
