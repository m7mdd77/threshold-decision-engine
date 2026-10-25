import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {AgentError} from './agent-error.js';

// A real supported Codex client; never impersonate it with HTTP headers.
// Only proposals cross this boundary. The application still owns every effect.
export async function invokeSupportedClient({config,messages,directory,signal,spawnImpl=spawn}) {
  const root=resolve(directory),cwd=resolve(root,'client-workspace'),home=resolve(root,'client-config');
  mkdirSync(cwd,{recursive:true});mkdirSync(home,{recursive:true});
  const instructions=resolve(home,'instructions.md');
  writeFileSync(instructions,messages[0].content+'\nReturn the requested JSON only. No tools, filesystem inspection, external actions, or follow-up turns.');
  const args=['--no-daemon','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--json','--color','never','--sandbox','read-only','--model',config.model];
  const settings={model_provider:'AgentRouter','model_providers.AgentRouter.name':'AgentRouter','model_providers.AgentRouter.base_url':new URL(config.endpoint).origin+'/v1','model_providers.AgentRouter.env_key':'AGENTROUTER_API_KEY','model_providers.AgentRouter.wire_api':'responses','model_providers.AgentRouter.request_max_retries':0,'model_providers.AgentRouter.stream_max_retries':0,'model_providers.AgentRouter.stream_idle_timeout_ms':25000,model_reasoning_effort:'low',model_reasoning_summary:'none',model_instructions_file:instructions.replaceAll('\\','/'),project_doc_max_bytes:0,'history.persistence':'none','analytics.enabled':false,'feedback.enabled':false,'features.shell_tool':false,'features.unified_exec':false,'features.apply_patch_freeform':false,'features.js_repl':false,'features.apps':false,'features.plugins':false,'features.memories':false,'features.memory_tool':false,'features.multi_agent':false,'features.multi_agent_v2':false,'features.browser_use':false,'features.in_app_browser':false,'features.request_permissions_tool':false,'agents.enabled':false,'tools.update_plan.enabled':false,'tools.experimental_request_user_input.enabled':false,web_search:'disabled'};
  for(const [key,value]of Object.entries(settings))args.push('-c',key+'='+JSON.stringify(value));args.push('-');
  const env={CODEX_HOME:home,AGENTROUTER_API_KEY:config.key};
  for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC'])if(process.env[key])env[key]=process.env[key];
  return new Promise((ok,no)=>{
    let output='',bytes=0,settled=false,usage={},text='',failed=false,filtered=false;
    const error=(code,message)=>Object.assign(new AgentError(502,code,message),{inputTokens:usage.input_tokens||0,outputTokens:usage.output_tokens||0,cacheReadTokens:usage.cache_read_input_tokens||0,estimatedCostUsd:null});
    if(signal?.aborted)return no(error('provider_timeout','The AI reading timed out. No action was authorized.'));
    const child=spawnImpl(config.clientPath,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finish=(err,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(err){child.kill();no(err);}else ok(result);};
    const abort=()=>finish(error('provider_timeout','The AI reading timed out. No automatic retry was made.'));
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>65536)return finish(error('invalid_output','The client returned too much output.'));output+=chunk.toString();});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('error',()=>finish(error('client_unavailable','The supported Codex client could not start. Check CODEX_PATH.')));
    child.on('close',code=>{
      if(settled)return;
      try{for(const line of output.trim().split('\n')){const e=JSON.parse(line);if(e.type==='turn.completed'){const u=e.usage||{},n=k=>Number.isSafeInteger(u[k])&&u[k]>=0?u[k]:0;usage={input_tokens:Math.max(0,n('input_tokens')-n('cached_input_tokens')),output_tokens:n('output_tokens'),cache_read_input_tokens:n('cached_input_tokens')};}
        if(e.type==='error'||e.type==='turn.failed'){failed=true;filtered ||= /content_filter/.test(String(e.message||e.error?.message||''));}
        if(e.type==='item.completed'&&e.item?.type==='agent_message')text+=e.item.text||'';
        if(e.type==='item.started'&&e.item?.type&&!['agent_message','reasoning'].includes(e.item.type))failed=true;
      }}catch{return finish(error('invalid_output','The supported client returned an invalid response.'));}
      if(code!==0||failed||!text)return finish(error('client_request_failed',filtered?'AgentRouter declined this reading under its content filter. No fallback or automatic retry was made.':'AgentRouter could not complete the Sol reading. No fallback or automatic retry was made.'));
      finish(null,{stop_reason:'end_turn',content:[{type:'text',text}],usage,estimatedCostUsd:null});
    });
    child.stdin.end(messages[1].content);
  });
}
