import { workBuddyLaunch } from './workbuddy.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function runWorkBuddy(options) {
  return runNativeSession({ ...options, workBuddy: true });
}
export function runClaude(options) {
  return runNativeSession(options);
}
function runNativeSession({ workBuddy = false, cwd, instructions, text, images = [], sessionId, onEvent = () => {}, onUsage = () => {}, onSpawn = () => {}, schema, ephemeral = false,
  model, effort, mcp, readDir, approve = async () => false }) {
  const id = sessionId || randomUUID();
  const name = workBuddy ? 'WorkBuddy' : 'Claude Code';
  const launch = workBuddy ? workBuddyLaunch() : { bin: process.env.CLAUDE_BIN || 'claude', prefix: [], env: process.env };
  if (!launch) return Promise.reject(Error('未找到 WorkBuddy'));
  const args = [...launch.prefix, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages',
    ...(workBuddy ? ['--tools', '', '--permission-mode', 'dontAsk',
      ...(!schema ? ['--allowedTools', 'mcp__nota__*'] : [])] : [
      '--tools', schema ? '' : 'default', '--permission-mode', schema ? 'dontAsk' : 'manual',
      ...(!schema ? ['--permission-prompt-tool', 'stdio', '--allowedTools', 'mcp__nota__*'] : []),
      '--disable-slash-commands', '--no-chrome', '--setting-sources', 'user',
      '--settings', JSON.stringify({ disableAllHooks: true,
        ...(!schema ? { sandbox: { enabled: true, autoAllowBashIfSandboxed: true, filesystem: { allowWrite: [cwd] } } } : {}) })]),
    '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: mcp || {} }),
    '--append-system-prompt', instructions,
    ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
    ...(ephemeral ? ['--no-session-persistence'] : sessionId ? ['--resume', sessionId] : ['--session-id', id]),
    ...(schema && !workBuddy ? ['--json-schema', JSON.stringify(schema)] : [])];
  const content = [{ type: 'text', text }, ...images.map(path => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(path).toString('base64') } }))];
  const proc = spawn(launch.bin, args, { cwd, env: launch.env, stdio: ['pipe','pipe','pipe'] });
  onSpawn(proc);
  return new Promise((resolve, reject) => {
    let result, error, stderr = '', settled = false;
    const timer = setTimeout(() => { error = Error(name + ' 响应超时，请重试'); proc.kill(); }, 360000);
    const finish = (err) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(result); };
    proc.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
    proc.on('error', e => finish(Error(e.code === 'ENOENT' ? '未找到 ' + name + '，请重新检测' : name + ' 启动失败')));
    proc.stdin.on('error', () => {});
    createInterface({ input: proc.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'control_request') {
        const r = m.request || {};
        if (r.subtype === 'can_use_tool') {
          approve('claude', r.tool_name + ': ' + JSON.stringify(r.input || {}), r.decision_reason || '').then(allowed => {
            if (proc.stdin.writable) proc.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id,
              response: allowed ? { behavior: 'allow', updatedInput: r.input } : { behavior: 'deny', message: '用户拒绝此操作' } } }) + '\n');
          });
        }
        return;
      }
      if (m.type === 'result') {
        onUsage(m);
        if (m.is_error) error = Error((m.errors || []).join('\n') || m.result || name + ' 未完成回答');
        else result = { text: m.result || '', structured: m.structured_output, sessionId: m.session_id || id };
        proc.stdin.end();
      }
      onEvent(m);
    });
    proc.on('close', code => finish(error || (!result ? Error(code === 0 ? name + ' 没有返回回答，请检查模型配置' : stderr.trim() || name + ' 已停止，请重试') : null)));
    const input = JSON.stringify({ type: 'user', session_id: id, message: { role: 'user', content }, parent_tool_use_id: null }) + '\n';
    if (schema || workBuddy) proc.stdin.end(input); else proc.stdin.write(input);
  });
}
