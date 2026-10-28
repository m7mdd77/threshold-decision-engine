import test from 'node:test';
import assert from 'node:assert/strict';
import {cerebrasConfig,invokeCerebras} from '../src/cerebras-client.js';
const key='csk-synthetic-unit-key-123456789';
const config=()=>cerebrasConfig({CEREBRAS_API_KEY:key});
const messages=[{role:'system',content:'Return one JSON object only. No tools.'},{role:'user',content:'Synthetic proposal request.'}];
const result=(extra={})=>new Response(JSON.stringify({model:'qwen-3.8-27b',choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:90,completion_tokens:12,prompt_tokens_details:{cached_tokens:20}},...extra}));

test('Cerebras configuration rejects old credentials and unapproved destinations or models',()=>{
 assert.equal(cerebrasConfig({AGENTROUTER_API_KEY:'old-key'}).configured,false);
 assert.throws(()=>cerebrasConfig({CEREBRAS_API_KEY:key,CEREBRAS_BASE_URL:'https://evil.test/v1'}));
 assert.throws(()=>cerebrasConfig({CEREBRAS_API_KEY:key,CEREBRAS_MODEL:'invented'}));
 assert.throws(()=>cerebrasConfig({CEREBRAS_API_KEY:'sk-wrong-provider'}));
});
test('one bounded truthful HTTPS call returns normalized actual usage without tools or key in the prompt',async()=>{
 let count=0;
 const r=await invokeCerebras({config:config(),messages,fetchImpl:async(url,options)=>{count++;assert.equal(url,'https://api.cerebras.ai/v1/chat/completions');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+key);const body=JSON.parse(options.body);assert.equal(body.model,'qwen-3.8-27b');assert.equal(body.reasoning_effort,'none');assert.equal(body.max_completion_tokens,2048);assert.deepEqual(body.response_format,{type:'json_object'});assert.ok(!('tools'in body));assert.ok(!options.body.includes(key));return result();}});
 assert.equal(count,1);assert.equal(r.model,'qwen-3.8-27b');assert.equal(r.content[0].text,'{"ok":true}');assert.deepEqual(r.usage,{input_tokens:70,output_tokens:12,cache_read_input_tokens:20});
});
test('tool calls, truncated output, wrong model and echoed credentials are refused',async()=>{
 for(const extra of[{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[{name:'execute'}]}}]},{model:'another-model'},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({key})}}]}])await assert.rejects(invokeCerebras({config:config(),messages,fetchImpl:async()=>result(extra)}),e=>e.code==='invalid_output'&&!e.message.includes(key));
});
test('rate limits retain Retry-After without retrying or exposing response bodies',async()=>{
 let calls=0;await assert.rejects(invokeCerebras({config:config(),messages,fetchImpl:async()=>{calls++;return new Response(key,{status:429,headers:{'retry-after':'6'}});}}),e=>e.providerFailure==='rate_limit'&&e.retryAfterMs===6000&&!JSON.stringify(e).includes(key));assert.equal(calls,1);
});
test('revoked requests never reach the provider and oversized bodies fail closed',async()=>{
 let calls=0;await assert.rejects(invokeCerebras({config:config(),messages,signal:AbortSignal.abort(),fetchImpl:async()=>{calls++;return result();}}),{code:'provider_timeout'});assert.equal(calls,0);
 await assert.rejects(invokeCerebras({config:config(),messages,fetchImpl:async()=>new Response('x'.repeat(65537))}),{code:'invalid_output'});
});
test('Relay-style plain text is an explicit mode, not silently coerced into JSON',async()=>{
 const r=await invokeCerebras({config:config(),messages,jsonMode:false,fetchImpl:async(_url,options)=>{assert.ok(!('response_format'in JSON.parse(options.body)));return result({choices:[{finish_reason:'stop',message:{content:'A synthetic repair draft is ready for review.'}}]});}});assert.match(r.content[0].text,/synthetic repair/);
});
