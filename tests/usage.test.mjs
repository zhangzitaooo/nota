import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {gatewayUsage,nativeUsage,recordUsage,readUsage,usageReport,recordCodexUsage,finishNativeUsage} from '../server/usage.mjs';
import {localGatewayConnection,closeGatewayRelays} from '../server/nota-relay.mjs';

test('paper ledgers deduplicate updates, separate unknown holds, and preserve history on restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nota-usage-'));mkdirSync(join(dir,'papers','paper-one'),{recursive:true});writeFileSync(join(dir,'papers','paper-one','paper.json'),'{}');
 try{
  const row={id:'1b93fbce-bc01-4aa2-a948-1e37038020bf',paper_id:'paper-one',purpose:'translation',operation_id:'batch-one',model:'deepseek-flash',status:'reserved',reserved_tokens:1000,created_at:123456};
  recordUsage(dir,gatewayUsage(row));assert.equal(usageReport(dir,'paper-one').pendingRequests,1);assert.equal(usageReport(dir,'paper-two').hasRecords,false);
  const settled=gatewayUsage({...row,status:'settled',input_tokens:10,cache_read_tokens:20,cache_write_tokens:0,output_tokens:5,total_tokens:35,settled_at:123499});
  recordUsage(dir,settled);recordUsage(dir,settled);recordUsage(dir,gatewayUsage(row));
  const report=usageReport(dir,'paper-one');assert.equal(report.totals.totalTokens,35);assert.equal(report.pendingRequests,0);assert.equal(report.records.length,1);
  assert.equal(readFileSync(join(dir,'usage.jsonl'),'utf8').trim().split('\n').length,2);
  assert.equal(readFileSync(join(dir,'papers','paper-one','usage.jsonl'),'utf8').trim().split('\n').length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('native usage counts caches once and aggregates Codex multi-step cumulative snapshots without double billing',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nota-native-usage-'));
 const make=(input,output,cached)=>({inputTokens:input,outputTokens:output,cachedInputTokens:cached,cacheWriteInputTokens:0,reasoningOutputTokens:0,totalTokens:input+output});
 const meta={paperId:'paper-one',purpose:'chat',operationId:'request-one',threadId:'thread-one',turnId:'turn-one',model:'test'};
 try{
  recordCodexUsage(dir,meta,{total:make(100,10,20),last:make(100,10,20)});
  recordCodexUsage(dir,meta,{total:make(250,30,80),last:make(150,20,60)});
  recordCodexUsage(dir,meta,{total:make(250,30,80),last:make(150,20,60)});
  finishNativeUsage(dir,{provider:'codex',...meta,status:'completed'});
  const next={...meta,operationId:'request-two',turnId:'turn-two'};
  finishNativeUsage(dir,{provider:'codex',...next,status:'completed'});
  recordCodexUsage(dir,next,{total:make(300,35,100),last:make(50,5,20)});
  const report=usageReport(dir,'paper-one');assert.equal(report.records.length,2);assert.equal(report.totals.totalTokens,335);assert.equal(report.totals.inputTokens,300);assert.equal(report.pendingRequests,0);
  assert.equal(report.records.find(r=>r.operationId==='request-two').status,'completed');
  assert.equal(nativeUsage('claude',{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:3,output_tokens:7}).totalTokens,40);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('per-runtime relay attribution cannot be spoofed by a child and persists the canonical gateway receipt',async()=>{
 const captured=[],observed=[];const gatewayId='8f7b4717-c9f8-4fad-b8f3-164991470dd4';
 const cloud=http.createServer(async(req,res)=>{
  for await(const _ of req){}
  captured.push({url:req.url,paper:req.headers['x-nota-paper-id'],purpose:req.headers['x-nota-purpose']});
  if(req.url.includes('/usage/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({request:{id:gatewayId,status:'settled',total_tokens:8}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream','X-Nota-Request-Id':gatewayId});res.end('data: result\n\n');
 });await new Promise(r=>cloud.listen(0,'127.0.0.1',r));
 const relay=await localGatewayConnection('usage-test',async()=>({baseURL:'http://127.0.0.1:'+cloud.address().port+'/anthropic',token:'host-private'}),{context:()=>({paperId:'paper-one',purpose:'translation',operationId:'batch-one'}),onUsage:row=>observed.push(row)});
 try{
  const r=await fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'x-api-key':relay.token,'x-nota-paper-id':'forged','Content-Type':'application/json'},body:'{}'});await r.text();await relay.flush();
  assert.equal(captured[0].paper,'paper-one');assert.equal(captured[0].purpose,'translation');assert.equal(observed[0].paper_id,'paper-one');assert.equal(observed.at(-1).total_tokens,8);
  assert.equal((await fetch(relay.baseURL+'/usage',{headers:{'x-api-key':relay.token}})).status,404);
 }finally{await closeGatewayRelays();cloud.closeAllConnections();await new Promise(r=>cloud.close(r));}
});
