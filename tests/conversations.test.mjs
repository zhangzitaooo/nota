import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { turnContext } from '../server/paper-environment.mjs';
import { migrateConversations } from '../server/conversations.mjs';

const paper = { id: 'paper-aaaa-1234', version: 1, parser: 'OXR', title: 'Synthetic paper', pages: [1], sourcePages: 1,
  blocks: [{ id: 'p1-b0', page: 1, type: 'Text', text: 'Model A: 80%. Model B: 75%.' }] };
const anchor = { paperId: paper.id, documentVersion: 1, blockId: 'p1-b0', page: 1, selectedText: paper.blocks[0].text,
  startOffset: 0, endOffset: paper.blocks[0].text.length, language: 'en' };
const legacy = () => ({ paper, threadId: 'old-thread', messages: [
  { id: 'old-request', role: 'user', text: '旧问题' },
  { id: 'old-answer', role: 'assistant', text: '旧回答', phase: 'final_answer', turnId: 'old-turn' }],
  requests: [{ ...anchor, requestId: 'old-request', status: 'completed' }], annotations: [],
  stats: { deltas: 0, saves: 0, resumes: 0 }, events: [] });

test('legacy migration preserves history, providers and immutable anchors across serialization', () => {
  const state = legacy(); migrateConversations(state);
  const c = state.conversations[0];
  assert.equal(c.threadId, 'old-thread'); assert.equal(c.title, '旧问题'); assert.equal(c.provider, 'codex');
  assert.equal(state.messages[1].anchor.blockId, anchor.blockId);
  const restarted = JSON.parse(JSON.stringify(state)); migrateConversations(restarted);
  assert.equal(restarted.conversations.length, 1); assert.deepEqual(restarted.messages, state.messages);
});

test('HTTP topics, streamed answers without annotations, provider switching, drafts and restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nota-conversations-'));
  mkdirSync(join(dir, 'papers', paper.id), { recursive: true });
  writeFileSync(join(dir, 'papers', paper.id, 'paper.json'), JSON.stringify(paper));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(legacy()));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({defaultAgent:'codex'}));
  const binary = join(dir, 'codex-test');
  writeFileSync(binary, `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('test 1');process.exit(0)}
if(process.argv.includes('login')){process.exit(0)}
const {createInterface}=require('node:readline');
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),p=m.params||{};if(!m.id)return;
let result={};
if(m.method==='initialize'){setTimeout(()=>out({id:m.id,result:{}}),350);return;}
if(m.method==='model/list')result={data:[{id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{id:'other',model:'other',displayName:'Other',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};
if(m.method==='account/read')result={account:{type:'chatgpt'}};
if(m.method==='thread/start')result={thread:{id:require('node:crypto').randomUUID()},model:'test'};
if(m.method==='thread/resume')result={thread:{id:p.threadId},model:'test'};
if(m.method==='thread/turns/list')result={data:[]};
if(m.method==='turn/start'){
 if(p.input?.[0]?.text?.includes('发送失败测试')){out({id:m.id,error:{message:'测试 Agent 拒绝请求'}});return;}
 const turnId=require('node:crypto').randomUUID(),itemId=require('node:crypto').randomUUID();result={turn:{id:turnId}};
 setTimeout(()=>{out({method:'turn/started',params:{threadId:p.threadId,turn:{id:turnId}}});
 out({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId,itemId,delta:'A 比 B 高'}});},20);
 setTimeout(()=>{out({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId,itemId,delta:' 5 个百分点。'}});
 out({method:'item/completed',params:{threadId:p.threadId,turnId,item:{id:itemId,type:'agentMessage',phase:'final_answer',text:'A 比 B 高 5 个百分点。'}}});
 out({method:'thread/tokenUsage/updated',params:{threadId:p.threadId,turnId,tokenUsage:{total:{inputTokens:20,outputTokens:10,cachedInputTokens:5,cacheWriteInputTokens:0,totalTokens:30},last:{inputTokens:20,outputTokens:10,cachedInputTokens:5,cacheWriteInputTokens:0,totalTokens:30}}}});
 out({method:'turn/completed',params:{threadId:p.threadId,turn:{id:turnId,status:'completed'}}});},240);
}
out({id:m.id,result});});`, { mode: 0o755 });
  const claudeBinary = join(dir, 'claude-test');
  writeFileSync(claudeBinary, `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('test 1');process.exit(0)}
if(process.argv.includes('auth')){console.log('private-account-details');process.exit(0)}
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const args=process.argv;const id=args.includes('--resume')?args[args.indexOf('--resume')+1]:args[args.indexOf('--session-id')+1];
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(m.type==='control_request'){out({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[{value:'default',displayName:'Default',supportedEffortLevels:['low','high']}]}}});return;}if(m.type!=='user')return;
out({type:'system',subtype:'init',session_id:id,model:'claude-test'});
out({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Claude 回答'}}});
out({type:'result',result:'Claude 回答',session_id:id});});`, { mode: 0o755 });
  let child, base;
  async function start() {
    child = spawn(process.execPath, ['server/server.mjs'], { cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, PAPER_DATA_DIR: dir, CODEX_BIN: binary, CLAUDE_BIN: claudeBinary, OPENCODE_BIN: join(dir,'missing-open'), AGY_BIN: binary, WORKBUDDY_BIN: join(dir,'missing-buddy'), DSH_BIN: claudeBinary, PORT: '0' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let log=''; child.stderr.on('data', b => log+=b);
    base = await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error(log||'timeout')),10000);
      child.once('error',reject); child.once('exit',()=>{clearTimeout(timer);reject(Error(log||'exit'));});
      child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve('http://127.0.0.1:'+m.port);}});
    });
  }
  async function stop() { const exit=once(child,'exit');child.kill();await exit; }
  const get=async()=> (await fetch(base+'/api/state')).json();
  const post=async(path,body)=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function complete() { for(let i=0;i<60;i++){const s=await get();if(!s.busy)return s;await new Promise(r=>setTimeout(r,25));}throw Error('turn timeout'); }
  try {
    await start(); let s=await get(); const old=s.activeConversationId;
    assert.equal(s.conversations.length,1); assert.equal(s.messages.length,2);
    let r=await post('conversations/create',{paperId:paper.id});assert.equal(r.status,200);s=await r.json();
    const first=s.activeConversationId, scope={paperId:paper.id,conversationId:first};
    assert.notEqual(first,old);assert.equal(s.messages.length,0);assert.equal(s.threadId,null);
    await post('conversations/draft',{...scope,draft:'暂存的问题'});
    const repeated = await (await post('conversations/create', scope)).json();
    assert.equal(repeated.activeConversationId, first);
    assert.equal(repeated.conversations.length, s.conversations.length);
    assert.equal(repeated.conversations.find(c => c.id === first).draft, '暂存的问题');
    const clientMessageId='94b69a62-53cd-49fa-a861-05a50a982e05';
    const secondAnchor = { ...anchor, selectedText: 'Model B', startOffset: 14, endOffset: 21 };
    const invalid = await post('ask', { ...scope, ...anchor, question: '查证两处', additionalAnchors: [{ ...secondAnchor, selectedText: 'invalid' }] });
    assert.equal(invalid.status, 400);
    assert.equal((await get()).messages.length, 0);
    const sending=post('ask',{...scope,...anchor,additionalAnchors:[secondAnchor],question:'A 比 B 高多少个百分点？',saveToAnnotation:true,clientMessageId});
    for(let i=0;i<100;i++){s=await get();if(s.connection==='connecting')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(s.connection,'connecting');
    assert.equal(s.messages.filter(m=>m.role==='user').length,1);
    assert.equal(s.messages[0].id,clientMessageId);
    assert.equal(s.messages[0].additionalAnchors[0].selectedText, 'Model B');
    const savedRequest = JSON.parse(readFileSync(join(dir,'state.json'))).requests.at(-1);
    assert.equal(JSON.parse(turnContext(paper, savedRequest, null)).additionalSelections[0].original, 'Model B');
    assert.equal(JSON.parse(readFileSync(join(dir,'state.json'))).messages[0].id,clientMessageId);
    r=await sending;assert.equal(r.status,200);
    const changed=await post('conversations/config',{...scope,model:'other',effort:'high'});assert.equal(changed.status,200);
    assert.equal((await post('conversations/create',{paperId:paper.id})).status,400);
    s=await complete(); const answer=s.messages.find(m=>m.role==='assistant');const firstThread=s.threadId;
    assert.equal(answer.text,'A 比 B 高 5 个百分点。');assert.equal(answer.anchor.selectedText,anchor.selectedText);
    assert.equal(s.annotations.length,0);assert(s.stats.deltas>=2);
    const usage=await (await fetch(base+'/api/usage?paperId='+paper.id+'&refresh=0')).json();
    assert.equal(usage.totals.totalTokens,30);assert.equal(usage.totals.cachedInputTokens,5);assert.equal(usage.records[0].operationId,clientMessageId);assert.equal(usage.knownRequests,1);
    assert.equal((await fetch(base+'/api/usage?paperId=..%2Foutside&refresh=0')).status,400);
    assert.equal((await fetch(base+'/api/usage?refresh=0',{headers:{Origin:'https://other.test'}})).status,403);
    assert.equal(s.requests.at(-1).model,'test');assert.equal(s.requests.at(-1).effort,'low');
    assert.equal(s.conversations.find(c=>c.id===first).model,'other');
    assert.equal(answer.model,'test');
    assert.equal(s.conversations.find(c=>c.id===first).draft,'');
    assert.equal(s.conversations.find(c=>c.id===first).title,'A 比 B 高多少个百分点？');
    const excerpt = { messageId: answer.id, start: 2, end: 7, text: answer.text.slice(2, 7) };
    const comment = { ...scope, id: '12345678-1234-4321-8222-123456789abc', excerpt, body: '记一下两者的差距' };
    for (let i = 0; i < 2; i++) assert.equal((await post('conversations/comment', comment)).status, 200);
    assert.equal((await get()).messages[1].comments.length, 1);
    assert.equal((await post('conversations/draft', { ...scope, draft: '继续解释', excerpts: [excerpt] })).status, 200);
    const saveBody={...scope,messageId:answer.id};
    r=await post('annotations/from-answer',saveBody);assert.equal(r.status,404);
    await post('conversations/rename',{...scope,title:'准确率差异'});
    s=await (await post('conversations/create',{paperId:paper.id})).json(); const second=s.activeConversationId;
    assert.equal((await post('ask',{...scope,...anchor,question:'过期请求'})).status,400);
    assert.equal((await post('annotations/from-answer',saveBody)).status,404);
    const scope2={paperId:paper.id,conversationId:second};
    assert.equal((await post('conversations/comment', { ...comment, ...scope2 })).status, 400);
    assert.equal((await post('ask', { ...scope2, documentVersion: 1, question: '不能串到其他对话', excerpts: [excerpt] })).status, 400);
    r=await post('ask',{...scope2,documentVersion:1,question:'解释百分点'});assert.equal(r.status,200);s=await complete();
    assert.notEqual(s.threadId,firstThread);assert.equal(s.messages.length,2);
    const unanchored=s.messages.find(m=>m.role==='assistant');
    assert.equal((await post('annotations/from-answer',{...scope2,messageId:unanchored.id})).status,404);
    assert.equal((await post('annotations/from-answer',{...scope2,messageId:unanchored.id,anchor})).status,404);
    await post('conversations/draft',{...scope2,draft:'下一次追问'});
    await stop();await start();s=await get();assert.equal(s.activeConversationId,second);assert.equal(s.conversations.length,3);
    assert.equal(s.conversations.find(c=>c.id===second).draft,'下一次追问');assert.equal(s.annotations.length,0);
    s=await (await post('conversations/switch',scope)).json();assert.equal(s.threadId,firstThread);assert.equal(s.messages[1].id,answer.id);
    assert.equal(s.conversations.find(c=>c.id===first).title,'准确率差异');
    assert.deepEqual(s.messages[1].comments[0].excerpt, excerpt);
    assert.deepEqual(s.conversations.find(c => c.id === first).draftExcerpts, [excerpt]);
    await post('ask',{...scope,documentVersion:1,excerpts:[excerpt],question:'继续解释'});s=await complete();assert.equal(s.threadId,firstThread);assert.equal(s.messages.length,4);assert.equal(s.requests.at(-1).model,'other');assert.equal(s.requests.at(-1).effort,'high');
    assert.equal(s.conversations.find(c=>c.id===first).title,'准确率差异');
    assert.deepEqual(s.messages[2].excerpts, [excerpt]);
    assert.deepEqual(s.conversations.find(c => c.id === first).draftExcerpts, []);
    const quotedTurn = JSON.parse(turnContext(paper, s.requests.at(-1), null));
    assert.deepEqual(quotedTurn.quotedChatMessages, [{ messageId: answer.id, text: excerpt.text }]);
    s=await (await post('conversations/switch',{paperId:paper.id,conversationId:old})).json();assert.equal(s.messages[1].text,'旧回答');
    const disk=JSON.parse(readFileSync(join(dir,'state.json')));assert.equal(disk.conversations.length,3);assert.equal(disk.annotations.length,0);
    const catalog=await (await fetch(base+'/api/settings')).json();
    assert.deepEqual(catalog.agents.map(a => a.id), ['builtin', 'codex', 'claude', 'antigravity', 'workbuddy', 'deepseek', 'opencode']);
    for (const [id, installed] of [['antigravity', true], ['workbuddy', false], ['deepseek', true]]) {
      const entry = catalog.agents.find(a => a.id === id);
      assert.equal(entry.installed, installed);
      assert.equal(entry.supported, id === "workbuddy");
      assert.equal(new URL(entry.guide).protocol, 'https:');
      assert.equal((await post('settings/agent', {provider: id})).status, 400);
    }
    assert.equal(catalog.agents.find(a=>a.id==='codex').installed,true);
    assert.equal(catalog.agents.find(a=>a.id==='opencode').installed,false);
    assert.equal(catalog.agents.find(a=>a.id==='opencode').supported,false);
    assert(!JSON.stringify(catalog).includes('private-account-details'));
    assert.equal((await post('settings/agent',{provider:'opencode'})).status,400);
    s=await (await post('settings/agent',{provider:'claude'})).json();
    assert.equal(s.activeConversationId,old);assert.equal(s.messages[1].text,'旧回答');
    s=await (await post('conversations/create',{paperId:paper.id})).json();
    const claudeTopic=s.activeConversationId;
    assert.equal(s.settings.defaultAgent,'claude');assert.equal(s.messages.length,0);
    assert.equal(s.conversations.find(c=>c.id===claudeTopic).provider,'claude');
    await post('ask',{paperId:paper.id,conversationId:claudeTopic,documentVersion:1,question:'新 Agent'});
    s=await complete();assert.equal(s.messages.at(-1).text,'Claude 回答');const claudeSession=s.threadId;
    await stop();await start();s=await get();assert.equal(s.settings.defaultAgent,'claude');assert.equal(s.threadId,claudeSession);
    await post('ask',{paperId:paper.id,conversationId:claudeTopic,documentVersion:1,question:'续聊'});
    s=await complete();assert.equal(s.messages.length,4);assert.equal(s.threadId,claudeSession);
    assert.equal(s.annotations.length,0);
    s=await (await post('conversations/switch',scope)).json();assert.equal(s.threadId,firstThread);
    assert.equal(s.conversations.find(c=>c.id===first).provider,'codex');
    // Runtime changes keep the topic, draft, history and each native session.
    await post('conversations/draft',{...scope,draft:'切换后保留草稿'});
    const historyLength=s.messages.length;
    s=await (await post('conversations/agent',{...scope,provider:'claude'})).json();
    assert.equal(s.activeConversationId,first);assert.equal(s.messages.length,historyLength);assert.equal(s.threadId,null);
    assert.equal(s.conversations.find(c=>c.id===first).draft,'切换后保留草稿');
    await post('ask',{...scope,documentVersion:1,question:'接着解释'});s=await complete();
    const switchedSession=s.threadId;assert.equal(s.messages.at(-1).text,'Claude 回答');
    const requestState=JSON.parse(readFileSync(join(dir,'state.json'))).requests.at(-1);
    assert(requestState.conversationContext.messages.some(m=>m.text.includes('5 个百分点')));
    s=await (await post('conversations/agent',{...scope,provider:'codex'})).json();assert.equal(s.threadId,firstThread);
    await post('ask',{...scope,documentVersion:1,question:'回到 Codex'});s=await complete();assert.equal(s.threadId,firstThread);
    s=await (await post('conversations/agent',{...scope,provider:'claude'})).json();assert.equal(s.threadId,switchedSession);
    s=await (await post('conversations/agent',{...scope,provider:'codex'})).json();
    const empty=await (await post('conversations/create',{paperId:paper.id})).json();
    const emptyScope={paperId:paper.id,conversationId:empty.activeConversationId};
    const changedEmpty=await (await post('conversations/agent',{...emptyScope,provider:'codex'})).json();
    assert.equal(changedEmpty.activeConversationId,emptyScope.conversationId);assert.equal(changedEmpty.messages.length,0);
    s=await (await post('conversations/switch',scope)).json();
    r=await post('ask',{...scope,documentVersion:1,question:'发送失败测试'});assert.equal(r.status,400);
    s=await get();assert.equal(s.busy,false);
    assert.equal(s.messages.at(-1).text,'发送失败测试');assert.equal(s.requests.at(-1).status,'failed');

  } finally {if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
