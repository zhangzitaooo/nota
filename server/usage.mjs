import {appendFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const validId = value => typeof value==='string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value);
const count = n => Number.isSafeInteger(n)&&n>=0?n:null;
export function gatewayUsage(row) {
  const input=count(row.input_tokens),read=count(row.cache_read_tokens),write=count(row.cache_write_tokens),output=count(row.output_tokens),total=count(row.total_tokens);
  const known=row.status==='settled'&&[input,read,write,output,total].every(n=>n!==null);
  return {id:'builtin:'+row.id,gatewayRequestId:row.id,paperId:row.paper_id||null,operationId:row.operation_id||null,
    purpose:row.purpose||'other',provider:'builtin',model:row.model||'deepseek-flash',status:row.status,outcome:row.outcome||null,
    usageKnown:known,inputTokens:known?input+read+write:null,uncachedInputTokens:known?input:null,
    cachedInputTokens:known?read:null,cacheWriteInputTokens:known?write:null,outputTokens:known?output:null,totalTokens:known?total:null,
    searchRequests:count(row.search_requests),initialReservedTokens:count(row.reserved_tokens),
    heldTokens:['reserved','pending'].includes(row.status)?count(row.reserved_tokens):0,
    chargedTokens:known?total:row.status==='released'?0:null,
    startedAt:new Date(row.created_at||Date.now()).toISOString(),settledAt:row.settled_at?new Date(row.settled_at).toISOString():null};
}
export function nativeUsage(provider,usage) {
  if(!usage)return null;
  if(provider==='codex') {
    const input=count(usage.inputTokens),output=count(usage.outputTokens),read=count(usage.cachedInputTokens??0),write=count(usage.cacheWriteInputTokens??0);
    if(input===null||output===null||read===null||write===null||read+write>input)return null;
    // Codex inputTokens includes cache hits; reasoning is included in output.
    return {inputTokens:input,uncachedInputTokens:input-read-write,cachedInputTokens:read,cacheWriteInputTokens:write,
      outputTokens:output,totalTokens:input+output,reasoningOutputTokens:count(usage.reasoningOutputTokens)};
  }
  const input=count(usage.input_tokens),output=count(usage.output_tokens),read=count(usage.cache_read_input_tokens??0),write=count(usage.cache_creation_input_tokens??0);
  if([input,output,read,write].some(n=>n===null))return null;
  return {inputTokens:input+read+write,uncachedInputTokens:input,cachedInputTokens:read,cacheWriteInputTokens:write,outputTokens:output,totalTokens:input+read+write+output};
}
export function readUsage(dataDir,paperId) {
  const path=join(dataDir,'usage.jsonl'),latest=new Map();
  if(existsSync(path))for(const line of readFileSync(path,'utf8').split('\n')) {
    if(!line.trim())continue;
    try{const record=JSON.parse(line);if(validId(record.id))latest.set(record.id,record);}catch{}
  }
  const values=[...latest.values()];
  return values.filter(r=>(!paperId||r.paperId===paperId)&&(!r.id.includes(':unknown:')||!values.some(x=>x.provider===r.provider&&x.operationId===r.operationId&&x.usageKnown)));
}
export function recordUsage(dataDir,record) {
  if(!validId(record.id)||!['builtin','codex','claude','workbuddy'].includes(record.provider)||(record.paperId&&!validId(record.paperId)))throw Error('用量记录标识无效');
  // Callers pass only normalized token/attribution fields, never prompts, tokens
  // used for authentication, model reasoning or provider payloads.
  const previous=readUsage(dataDir).find(r=>r.id===record.id);
  if(previous?.applicationOutcome&&!record.applicationOutcome)record={...record,applicationOutcome:previous.applicationOutcome};
  if(previous?.usageKnown&&!record.usageKnown)return previous;
  if(JSON.stringify(previous)===JSON.stringify(record))return previous;
  mkdirSync(dataDir,{recursive:true});const line=JSON.stringify(record)+'\n';
  appendFileSync(join(dataDir,'usage.jsonl'),line,{mode:0o600});
  if(record.paperId&&existsSync(join(dataDir,'papers',record.paperId,'paper.json')))
    appendFileSync(join(dataDir,'papers',record.paperId,'usage.jsonl'),line,{mode:0o600});
  return record;
}
export function usageReport(dataDir,paperId) {
  const records=readUsage(dataDir,paperId);
  const totals=records.filter(r=>r.usageKnown).reduce((t,r)=>{for(const key of ['inputTokens','uncachedInputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','totalTokens'])t[key]+=(r[key]||0);return t;},
    {inputTokens:0,uncachedInputTokens:0,cachedInputTokens:0,cacheWriteInputTokens:0,outputTokens:0,totalTokens:0});
  return {paperId:paperId||null,unit:'tokens',coverage:'Recorded requests only; historical untracked work is not zero usage',hasRecords:records.length>0,totals,
    knownRequests:records.filter(r=>r.usageKnown).length,pendingRequests:records.filter(r=>!r.usageKnown&&r.status!=='released').length,
    releasedRequests:records.filter(r=>r.status==='released').length,records};
}
export function recordCodexUsage(dataDir,meta,tokenUsage,{ephemeral=false}={}) {
  const records=readUsage(dataDir),id=`codex:${meta.threadId}:${meta.turnId}`;
  const previous=records.find(r=>r.id===id);
  const terminal=records.find(r=>r.provider==='codex'&&r.operationId===meta.operationId&&r.status!=='running');
  const fields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens'];
  const current=tokenUsage.total;
  if(!current)return;
  let baseline=previous?.baseline;
  if(!baseline){
    const prior=records.filter(r=>r.provider==='codex'&&r.threadId===meta.threadId&&r.providerTotal&&r.turnId!==meta.turnId)
      .sort((a,b)=>(b.providerTotal.totalTokens||0)-(a.providerTotal.totalTokens||0))[0];
    baseline=ephemeral?Object.fromEntries(fields.map(k=>[k,0])):prior?.providerTotal;
    if(!baseline)baseline=Object.fromEntries(fields.map(k=>[k,(current[k]||0)-(tokenUsage.last?.[k]||0)]));
  }
  let delta=Object.fromEntries(fields.map(k=>[k,(current[k]||0)-(baseline[k]||0)]));
  if(Object.values(delta).some(n=>n<0)){baseline=Object.fromEntries(fields.map(k=>[k,(current[k]||0)-(tokenUsage.last?.[k]||0)]));delta=tokenUsage.last;}
  const usage=nativeUsage('codex',delta);if(!usage)return;
  return recordUsage(dataDir,{id,provider:'codex',purpose:meta.purpose,paperId:meta.paperId,operationId:meta.operationId,
    threadId:meta.threadId,turnId:meta.turnId,model:meta.model||null,status:previous?.status&&previous.status!=='running'?previous.status:terminal?.status||'running',
    startedAt:previous?.startedAt||new Date().toISOString(),usageKnown:true,...usage,baseline,providerTotal:current});
}
export function finishNativeUsage(dataDir,{provider,operationId,paperId,purpose,model,status}) {
  const records=readUsage(dataDir).filter(r=>r.provider===provider&&r.operationId===operationId);
  if(!records.length)return recordUsage(dataDir,{id:`${provider}:unknown:${operationId}`,provider,operationId,paperId,purpose,model:model||null,status,usageKnown:false,totalTokens:null,startedAt:new Date().toISOString()});
  for(const record of records)recordUsage(dataDir,{...record,status});
}

export function recordApplicationOutcome(dataDir,operationId,outcome) {
  for(const record of readUsage(dataDir).filter(r=>r.operationId===operationId))
    recordUsage(dataDir,{...record,applicationOutcome:outcome});
}
