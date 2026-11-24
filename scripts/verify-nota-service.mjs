// Explicit, bounded live verification. Never run in the automatic test suite.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareEnvironment } from '../server/paper-environment.mjs';
import { DeepSeekRuntime } from '../server/deepseek.mjs';
import { closeGatewayRelays } from '../server/nota-relay.mjs';
const dir=mkdtempSync(join(tmpdir(),'nota-live-verification-'));
const configPath=process.argv[2];if(!configPath)throw Error('Supply installed agent-gateway.json path');
writeFileSync(join(dir,'agent-gateway.json'),readFileSync(configPath),{mode:0o600});
const paper={id:'nota-live-test',version:1,title:'Accuracy comparison',pages:[1],blocks:[{id:'p1-b0',page:1,type:'Text',text:'Model A accuracy is 80%. Model B accuracy is 75%.'}]};
mkdirSync(join(dir,'papers',paper.id),{recursive:true});
const environment=prepareEnvironment(dir,join(dir,'papers'),paper,{segments:[]});
const events=[],frames=[];let rt;
const make=()=>new DeepSeekRuntime({dataDir:dir,environment,model:'deepseek-flash',effort:'off',mcpFile:resolve('server/paper-mcp.mjs'),onEvent:e=>events.push(e.event),onStream:e=>frames.push(e.frame),approve:async()=>false});
try {
 rt=make();await rt.start();console.log('Live DSH initialized');
 const run=await rt.run('这是服务连通性测试。请先使用 mcp__nota__paper_read 读取 p1-b0，再使用 bash 运行 printf 5 > result.txt; cat result.txt。最后根据论文用中文回答准确率相差多少个百分点，只用一句话。');
 await run.done;
 const tools=events.filter(e=>e.type==='tool/call').map(e=>e.data.name);console.log(JSON.stringify({tools,frames:frames.length}));
 assert(tools.includes('mcp__nota__paper_read'),'paper tool was not called');assert(tools.includes('bash'),'Bash was not called');assert.equal(readFileSync(join(environment.cwd,'result.txt'),'utf8'),'5');
 assert(frames.some(f=>f.type==='chunk'&&f.chunk.type==='text-delta'),'no text streamed');
 await rt.shutdown();rt=make();await rt.start();const resumed=await rt.run('继续刚才对话，两个模型的准确率分别是多少？只回答一句话，不用工具。',run.sessionId);await resumed.done;assert.equal(resumed.sessionId,run.sessionId);
 console.log(JSON.stringify({live:true,streaming:true,paperRead:true,bash:true,restartResume:true,sessionId:run.sessionId}));
 await rt.shutdown();rt=null;
}finally{rt?.close();await closeGatewayRelays();rmSync(dir,{recursive:true,force:true});}
