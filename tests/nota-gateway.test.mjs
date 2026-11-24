import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {createNotaGateway,tokenHash} from '../server/nota-gateway.mjs';
import {randomBytes} from 'node:crypto';

test('managed gateway authenticates, fixes Flash, bounds usage and keeps upstream key private across restarts', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nota-gateway-'));const token=randomBytes(32).toString('hex'),upstreamKey='operator-key-never-return';let calls=0,captured;
 const options={apiKey:upstreamKey,clients:[{id:'installation-a',tokenHash:tokenHash(token),expiresAt:'2099-01-01'}],ledgerFile:join(dir,'usage.json'),clientDailyBudget:18000,
   fetchImpl:async(url,options)=>{calls++;captured={url,headers:options.headers,body:JSON.parse(options.body)};return new Response('data: {"text":"ok"}\n\n',{headers:{'content-type':'text/event-stream'}});}};
 let server,base;
 async function start(){server=createNotaGateway(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 const stop=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};
 const request=(path,body,key=token)=>fetch(base+path,{method:body?'POST':'GET',headers:{'x-api-key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{await start();assert.equal((await request('/models',null,'wrong')).status,401);
  const models=await(await request('/models')).json();assert.deepEqual(models.data.map(m=>m.id),['deepseek-flash']);
  assert(!JSON.stringify(models).includes(upstreamKey));
  assert.equal((await request('/v1/messages',{model:'deepseek-v4-pro',messages:[{role:'user',content:'hi'}]})).status,400);assert.equal(calls,0);
  assert.equal((await request('/arbitrary-forward',{url:'https://other.host'})).status,404);
  const body={model:'deepseek-flash',messages:[{role:'user',content:'hello'}],max_tokens:256000,stream:true,baseURL:'https://evil.invalid'};
  let r=await request('/anthropic/v1/messages',body);assert.equal(r.status,200);const text=await r.text();assert(text.includes('ok'));assert(!text.includes(upstreamKey));
  assert.equal(captured.body.max_tokens,8192);assert.equal(captured.body.model,'deepseek-flash');assert(!captured.body.baseURL);assert.equal(captured.headers['x-api-key'],upstreamKey);
  assert.equal(captured.url,'https://api.deepseek.com/anthropic/v1/messages');
  r=await request('/v1/messages',body);await r.text();assert.equal(r.status,200);
  await stop();await start();r=await request('/v1/messages',body);assert.equal(r.status,429);assert.equal(calls,2);
 }finally{if(server?.listening)await stop();rmSync(dir,{recursive:true,force:true});}
});
test('gateway rejects expired tokens and caps auxiliary web-search usage', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nota-gateway-web-'));const token=randomBytes(32).toString('hex');let captured;
 const server=createNotaGateway({apiKey:'private-upstream',ledgerFile:join(dir,'usage.json'),requestsPerMinute:1,clients:[{id:'valid',tokenHash:tokenHash(token),expiresAt:'2099-01-01'},{id:'expired',tokenHash:tokenHash('x'.repeat(40)),expiresAt:'2000-01-01'}],fetchImpl:async(url,options)=>{captured=JSON.parse(options.body);return Response.json({content:[]});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/models',{headers:{'x-api-key':'x'.repeat(40)}})).status,401);
  const init={method:'POST',headers:{'Content-Type':'application/json','x-api-key':token},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'search'}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:999}]})};
  const r=await fetch(base+'/v1/messages',init);assert.equal(r.status,200);await r.text();assert.equal(captured.tools[0].max_uses,2);
  assert.equal((await fetch(base+'/v1/messages',init)).status,429);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
