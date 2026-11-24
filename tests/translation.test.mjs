import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createTranslations} from '../server/translation.mjs';
import {closeGatewayRelays} from '../server/nota-relay.mjs';

// Boot the shipped SDK and actual translation worker. Only model HTTP is local.
test('managed translation batches fit the output cap, preserve every anchor and persist Chinese', {timeout:45000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nota-translation-'));
 const paper={id:'paper-translation-real-sdk',parser:'OXR',version:1,title:'Translation fixture',pages:[1,2],blocks:Array.from({length:65},(_,i)=>({id:'b'+i,page:i<32?1:2,type:'Text',text:(i<5?'Scientific prose '.repeat(100):'Model A has an accuracy of 80 percent')+'.'}))};
 const papers=join(dir,'papers');mkdirSync(join(papers,paper.id),{recursive:true});
 const requests=[];
 const cloud=http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-flash'}]}));return;}
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);let batch;
  for(const m of body.messages||[])for(const b of Array.isArray(m.content)?m.content:[]){if(b.type==='text'){try{const d=JSON.parse(b.text);if(d.segments)batch=d.segments;}catch{}}}
  if(batch)requests.push({batch,effort:body.thinking?.type,maxTokens:body.max_tokens,tools:body.tools});
  const text=batch?JSON.stringify(Object.fromEntries(batch.map(s=>[s.id,'这是完整的科学论文译文。']))):'Translation';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const out=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  out('message_start',{message:{id:'fixture',type:'message',role:'assistant',model:'deepseek-flash',content:[],usage:{input_tokens:10,output_tokens:0}}});
  out('content_block_start',{index:0,content_block:{type:'text',text:''}});
  out('content_block_delta',{index:0,delta:{type:'text_delta',text}});out('content_block_stop',{index:0});
  out('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}});out('message_stop',{});res.end();
 });
 await new Promise(r=>cloud.listen(0,'127.0.0.1',r));
 const saved={key:process.env.NOTA_AGENT_TOKEN,url:process.env.NOTA_AGENT_GATEWAY_URL};
 process.env.NOTA_AGENT_TOKEN='test-only-translation';process.env.NOTA_AGENT_GATEWAY_URL='http://127.0.0.1:'+cloud.address().port+'/anthropic';
 const translations=createTranslations(resolve('server'),papers,()=>{},()=>'builtin',dir);
 try{
  translations.start(paper);
  for(let i=0;i<400&&translations.active;i++)await new Promise(r=>setTimeout(r,50));
  const result=translations.get(paper);
  assert.equal(result.status,'completed',result.error);assert.equal(result.completed,65);assert.equal(result.total,65);
  assert.equal(new Set(requests.flatMap(r=>r.batch.map(s=>s.id))).size,65);
  assert(requests.length>=4);
  for(const r of requests){assert(r.batch.length<=30);assert(r.batch.reduce((n,s)=>n+s.source.length,0)<=5000);assert.equal(r.effort,'disabled');assert.equal(r.maxTokens,8192);assert(!r.tools?.length);}
  const disk=JSON.parse(readFileSync(join(papers,paper.id,'translation.json')));
  for(const s of disk.segments){assert.equal(s.zh,'这是完整的科学论文译文。');assert.equal(paper.blocks.find(b=>b.id===s.blockId).text.slice(s.start,s.end),s.source);}
 }finally{
  translations.close();await closeGatewayRelays();cloud.closeAllConnections();await new Promise(r=>cloud.close(r));
  for(const [key,value]of [['NOTA_AGENT_TOKEN',saved.key],['NOTA_AGENT_GATEWAY_URL',saved.url]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  rmSync(dir,{recursive:true,force:true});
 }
});
