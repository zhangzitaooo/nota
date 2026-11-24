import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { localGatewayConnection, closeGatewayRelays } from '../server/nota-relay.mjs';
test('loopback relay requires private runtime token, restricts route/origin and attaches host credentials',async()=>{
 let received;
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received={url:req.url,headers:req.headers,body};res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: streamed\n\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const relay=await localGatewayConnection('test',async()=>({baseURL:`http://127.0.0.1:${upstream.address().port}/anthropic`,token:'installation-secret-test',serviceToken:'private-service-test'}));
 try {
  assert.equal((await fetch(relay.baseURL+'/models')).status,403);
  assert.equal((await fetch(relay.baseURL+'/models',{headers:{'x-api-key':relay.token,origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(relay.baseURL+'/models',{headers:{'x-api-key':'é'.repeat(relay.token.length)}})).status,403);
  assert.equal((await fetch(relay.baseURL+'/v1/anything',{headers:{'x-api-key':relay.token}})).status,404);
  const r=await fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'x-api-key':relay.token,'content-type':'application/json'},body:'{"messages":[]}'});
  assert.equal(await r.text(),'data: streamed\n\n');assert.equal(received.url,'/anthropic/v1/messages');assert.equal(received.headers['x-api-key'],'installation-secret-test');assert.equal(received.headers['oai-sites-authorization'],'Bearer private-service-test');
  assert.notEqual(relay.token,'installation-secret-test');
 }finally{await closeGatewayRelays();await new Promise(r=>upstream.close(r));}
});
