import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareEnvironment, turnContext, callPaperTool } from '../server/paper-environment.mjs';
import { chooseConfig, builtinConnection } from '../server/agent-config.mjs';
import { ApprovalBroker } from '../server/approval-broker.mjs';
import { DeepSeekRuntime } from '../server/deepseek.mjs';

test('fresh installations have independent, persistent public trial credentials', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nota-trial-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.NOTA_AGENT_GATEWAY_URL;
  delete process.env.NOTA_AGENT_GATEWAY_URL;
  try {
    const first = await builtinConnection(join(dir, 'first'));
    assert.equal(first.baseURL, 'https://nota-agent-gateway.zhangzitao997.chatgpt.site/anthropic');
    assert.equal(first.serviceToken, '');
    assert.match(first.token, /^nota-trial-v1-[a-f0-9]{64}$/);
    assert.equal((await builtinConnection(join(dir, 'first'))).token, first.token);
    assert.notEqual((await builtinConnection(join(dir, 'second'))).token, first.token);
  } finally {
    if (previous !== undefined) process.env.NOTA_AGENT_GATEWAY_URL = previous;
  }
});

const paper = { id: 'paper-runtime-test', version: 2, title: 'Accuracy comparison', pages: [1, 2], blocks: [
  { id: 'p1-b0', type: 'Text', page: 1, text: 'Model A: 80%. Model B: 75%.' },
  { id: 'p2-b0', type: 'Text', page: 2, text: 'long text '.repeat(5000) },
  { id: 'p2-b1', type: 'Picture', page: 2, text: '', asset: 'figure.png' },
] };
const translation = { segments: [{ id: 's1', blockId: 'p1-b0', source: paper.blocks[0].text, zh: '准确率 A 为 80%，B 为 75%。' }] };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'nota-runtime-test-')); const source = join(dir, 'papers', paper.id); mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'figure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=', 'base64'));
  return { dir, source, ...prepareEnvironment(dir, join(dir, 'papers'), paper, translation) };
}
test('on-demand paper tools retain bilingual anchors and protect figure paths', () => {
  const f = fixture();
  try {
    const search = JSON.parse(callPaperTool(f.manifest, 'paper_search', { query: '准确率' }).content[0].text);
    assert.equal(search.matches[0].blockId, 'p1-b0'); assert.equal(search.documentVersion, 2);
    const page = JSON.parse(callPaperTool(f.manifest, 'paper_read', { page: 2 }).content[0].text); assert.equal(page.nextOffset, 24000);
    const next = JSON.parse(callPaperTool(f.manifest, 'paper_read', { page: 2, offset: page.nextOffset }).content[0].text); assert(next.source.length > 0);
    assert.equal(callPaperTool(f.manifest, 'paper_figure', { blockId: 'p2-b1' }).content[1].type, 'image');
    writeFileSync(join(f.dir, 'outside.png'), 'outside'); rmSync(join(f.source, 'figure.png')); symlinkSync(join(f.dir, 'outside.png'), join(f.source, 'figure.png'));
    assert.throws(() => callPaperTool(f.manifest, 'paper_figure', { blockId: 'p2-b1' }), /路径无效/);
    const context = turnContext(paper, { blockId: 'p1-b0', question: '差多少？', selectedText: paper.blocks[0].text, startOffset: 0, endOffset: 27, translatedText: '准确率', segmentId: 's1', translationVersion: 4 }, { page: 1, blockId: 'p1-b0', mode: 'zh' });
    assert(context.length < 1400); assert(!context.includes('long text')); assert.equal(JSON.parse(context).selection.translationVersion, 4);
    assert.equal(JSON.parse(context).readingPosition.mode, 'zh'); assert(!f.resourceDir.startsWith(f.cwd));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('model-specific reasoning preferences reject invented options', () => {
  const models = [{ id: 'one', default: true, defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] }, { id: 'two', defaultEffort: null, efforts: [] }];
  assert.deepEqual(chooseConfig(models, {}), { model: 'one', effort: 'low' });
  const c = { model: 'two', effort: null, modelPreferences: { one: 'high' } };
  assert.deepEqual(chooseConfig(models, c, { model: 'one' }), { model: 'one', effort: 'high' });
  assert.deepEqual(chooseConfig(models, c), { model: 'two', effort: null });
  assert.throws(() => chooseConfig(models, c, { model: 'one', effort: 'max' }));
  assert.throws(() => chooseConfig(models, c, { model: 'invented' }));
});
test('permission decisions are one-time, cancellation fails closed', async () => {
  const broker = new ApprovalBroker();
  const allow = broker.request('codex', 'outside write'); const id = broker.list()[0].id;
  assert(broker.answer(id, true)); assert.equal(await allow, true); assert.equal(broker.answer(id, true), false);
  const deny = broker.request('builtin', 'another write'); broker.cancel(); assert.equal(await deny, false); assert.equal(broker.list().length, 0);
});

// This boots the shipped DSH runtime, tools, sandbox and persistence. Only the
// remote model is simulated; this does not claim a live DeepSeek cloud result.
test('bundled DSH executes paper/Bash tools, streams and resumes with changed effort', { timeout: 45000 }, async () => {
  const f = fixture(), savedEnv = { key: process.env.NOTA_AGENT_TOKEN, base: process.env.NOTA_AGENT_GATEWAY_URL };
  const outsideDir = mkdtempSync(join(homedir(), '.nota-permission-test-'));
  const outsideFile = join(outsideDir, 'outside.txt');
  const requests = [], events = [], frames = []; let turn = 0, approvals = 0, rt, truncateNext = false;
  const cloud = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}'); requests.push(body);
    const truncated = truncateNext; truncateNext = false;
    const content = turn++ === 0 ? { type: 'tool_use', id: 'read-paper', name: 'mcp__nota__paper_read', input: { blockId: 'p1-b0' } }
      : turn === 2 ? { type: 'tool_use', id: 'calculate', name: 'bash', input: { description: 'Compute accuracy difference in the workspace', command: 'printf 5 > result.txt; cat result.txt' } }
      : turn === 4 ? { type: 'tool_use', id: 'outside-denied', name: 'bash', input: { description: 'Check sandbox denial outside the workspace', command: `printf denied > '${outsideFile}'` } }
      : turn === 5 ? { type: 'tool_use', id: 'outside-write', name: 'bash', input: { description: 'Verify permission denial outside the workspace', command: `printf denied > '${outsideFile}'`, sandbox_permissions: 'danger-full-access', justification: 'Test one-time approval for writing outside the paper workspace.' } }
      : { type: 'text', text: 'A 比 B 高 5 个百分点。' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const out = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    out('message_start', { message: { id: `remote-${turn}`, type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
    out('content_block_start', { index: 0, content_block: content.type === 'text' ? { type: 'text', text: '' } : { ...content, input: {} } });
    out('content_block_delta', { index: 0, delta: content.type === 'text' ? { type: 'text_delta', text: content.text } : { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } });
    out('content_block_stop', { index: 0 }); out('message_delta', { delta: { stop_reason: truncated ? 'max_tokens' : content.type === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } }); out('message_stop', {}); res.end();
  });
  await new Promise(r => cloud.listen(0, '127.0.0.1', r));
  process.env.NOTA_AGENT_TOKEN = 'nota-offline-test-key'; process.env.NOTA_AGENT_GATEWAY_URL = `http://127.0.0.1:${cloud.address().port}/anthropic`;
  const create = effort => new DeepSeekRuntime({ dataDir: f.dir, environment: f, model: 'deepseek-flash', effort, mcpFile: resolve('server/paper-mcp.mjs'), onEvent: e => events.push(e.event), onStream: s => frames.push(s.frame), approve: async () => { approvals++; return false; } });
  try {
    rt = create('low'); await rt.start(); const run = await rt.run('Read the source and compute the accuracy difference.'); await run.done;
    const names = requests[0].tools.map(t => t.name); for (const name of ['mcp__nota__paper_read', 'bash', 'web_search', 'web_fetch']) assert(names.includes(name), name);
    assert(events.some(e => e.type === 'tool/call' && e.data.name === 'mcp__nota__paper_read'));
    assert(events.some(e => e.type === 'tool/call' && e.data.name === 'bash'));
    assert.equal(readFileSync(join(f.cwd, 'result.txt'), 'utf8'), '5');
    assert(frames.some(f => f.type === 'chunk' && f.chunk.type === 'text-delta'));
    assert(JSON.stringify(requests[1].messages).includes('Model A: 80%'));
    const before = requests.at(-1).messages.length;
    await rt.shutdown(); rt = create('high'); await rt.start(); const resumed = await rt.run('继续解释', run.sessionId); await resumed.done;
    assert.equal(resumed.sessionId, run.sessionId); assert(requests.at(-1).messages.length > before);
    assert.equal(approvals, 1, JSON.stringify({schema: requests[0].tools.find(t=>t.name==='bash').input_schema.properties.sandbox_permissions, recent: requests.at(-1).messages.slice(-2)})); assert(!existsSync(outsideFile));
    assert.equal(requests[0].output_config?.effort, 'low'); assert.equal(requests.at(-1).output_config?.effort, 'high');
    truncateNext = true;
    const limited = await rt.run('测试输出截断', run.sessionId);
    await assert.rejects(limited.done, { code: 'OUTPUT_LIMIT' });
    const retry = await rt.run('重新完整回答', run.sessionId); await retry.done;
    await rt.shutdown(); rt = null;
    const keyString = 'nota-offline-test-key'; assert(!JSON.stringify(events).includes(keyString));
  } finally {
    rt?.close(); cloud.closeAllConnections(); await new Promise(r => cloud.close(r));
    for (const [name, value] of [['NOTA_AGENT_TOKEN', savedEnv.key], ['NOTA_AGENT_GATEWAY_URL', savedEnv.base]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(f.dir, { recursive: true, force: true }); rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('SDK idle receipt preserves quota errors from the terminal event', async () => {
  const f = fixture();
  const cli = join(f.dir, 'failed-sdk.mjs');
  writeFileSync(cli, `import {createInterface} from 'node:readline';
const out = m => process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);if(!m.id)return;
 if(m.method==='session/prompt'){
  const sessionId=m.params.sessionId;
  for(const event of [{type:'turn/start',data:{}},{type:'turn/end',data:{reason:{kind:'error',error:{code:'RATE_LIMIT',status:429,message:'今日免费额度已用完'}}}}])
   out({method:'session.event',params:{sessionId,event}});
 }
 out({id:m.id,result:{}});
 if(m.method==='shutdown')process.exit(0);
});`);
  const keys = ['PAPER_DSH_CLI','NOTA_AGENT_TOKEN','NOTA_AGENT_GATEWAY_URL'];
  const saved = Object.fromEntries(keys.map(k => [k,process.env[k]]));
  process.env.PAPER_DSH_CLI = cli;
  process.env.NOTA_AGENT_TOKEN = 'test-only-translation-token';
  process.env.NOTA_AGENT_GATEWAY_URL = 'http://127.0.0.1:1/anthropic';
  const rt = new DeepSeekRuntime({dataDir:f.dir,environment:f,model:'deepseek-flash',effort:'off',tools:false});
  try {
    await rt.start(); const run=await rt.run('Translate a paper');
    await assert.rejects(run.done, {message:'今日免费额度已用完',code:'RATE_LIMIT',status:429});
  } finally {
    await rt.shutdown().catch(()=>{});
    for(const key of keys) { if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]; }
    rmSync(f.dir,{recursive:true,force:true});
  }
});
