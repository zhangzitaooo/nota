import {gatewayUsage,recordUsage} from './usage.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JsonlClient } from './jsonl-client.mjs';
import { dshLaunch, builtinRuntimeConnection } from './agent-config.mjs';
import { readingInstructions } from './paper-environment.mjs';

export class DeepSeekRuntime {
  constructor({ dataDir, homeDir, environment, model, effort, maxTokens, mcpFile, usageContext = {}, approve = async () => false, onEvent = () => {}, onStream = () => {}, persona = readingInstructions, tools = true }) {
    Object.assign(this, { dataDir, homeDir, environment, model, effort, maxTokens, mcpFile, usageContext, approve, onEvent, onStream, persona, tools }); this.opened = new Set();
    this.terminalReasons = new Map();this.relayKey={};
  }
  async start() {
    const connection = await builtinRuntimeConnection(this.dataDir,{key:this.relayKey,context:()=>this.usageContext,onUsage:row=>recordUsage(this.dataDir,gatewayUsage(row))});this.connection=connection; if (!connection) throw Error('Nota Agent 暂未开通，请先使用本机 Agent');
    const home = this.homeDir || join(this.dataDir, 'deepseek-harness'); mkdirSync(home, { recursive: true, mode: 0o700 });
    const patch = join(home, `nota-${randomUUID()}.patch.json`);
    writeFileSync(patch, JSON.stringify([
      { id: 'system-prompt', config: { personaPrefix: this.persona } },
      { id: 'tool-plugin-manager', disabled: true },
      { id: 'web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: connection.baseURL + '/v1', model: this.model } },
      { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: this.environment.cwd } },
      { id: 'approval', config: { policy: 'ask' } },
      { id: 'tool-schedule', disabled: true },
      { id: 'schedule', disabled: true },
      { id: 'tool-ask-user', disabled: true },
      ...(!this.tools ? ['tool-working-directory', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow', 'tool-todo', 'tool-goal', 'tool-web', 'present'].map(id => ({ id, disabled: true })) : []),
      { insert: [
        { id: 'nota-stream', name: fileURLToPath(new URL('./dsh-stream.mjs', import.meta.url)) },
        ...(this.tools ? [{ id: 'nota-paper', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'nota', transport: 'stdio', command: process.execPath, args: [this.mcpFile, this.environment.manifest], failOnStartupError: true } }] : []),
      ] },
    ], null, 2));
    const { node, cli } = dshLaunch(); const calls = new Map();
    this.client = new JsonlClient(node, [cli, '--profile', 'sdk', '--patch', patch], {
      cwd: this.environment.cwd, env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: connection.token, DEEPSEEK_BASE_URL: connection.baseURL, DEEPSEEK_SEARCH_BASE_URL: connection.baseURL + '/v1' },
      onMessage: async (m, client) => {
        if (m.method === 'approval/request') {
          const call = calls.get(m.params.callId);
          const allowed = await this.approve('builtin', call ? `${call.name}: ${call.arguments}` : m.params.toolName, m.params.reason);
          client.send({ id: m.id, result: { outcome: allowed ? 'allowed-once' : 'rejected' } });
        } else if (m.method === 'session.event') {
          if (m.params.event.type === 'turn/start') this.terminalReasons.delete(m.params.sessionId);
          if (m.params.event.type === 'turn/end') this.terminalReasons.set(m.params.sessionId, m.params.event.data.reason);
          if (m.params.event.type === 'tool/call') calls.set(m.params.event.data.callId, m.params.event.data);
          if (m.params.event.type === 'tool/result') calls.delete(m.params.event.data.callId);
          this.onEvent(m.params);
        }
        else if (m.method === 'nota.stream') this.onStream(m.params);
        else if (m.id !== undefined && m.method) client.send({ id: m.id, error: { code: -32601, message: 'Unsupported host request' } });
      },
    });
    try { await this.client.request('initialize', { cwd: this.environment.cwd, provider: 'deepseek-official', model: this.model,
      ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
      ...(this.effort ? { reasoningEffort: this.effort } : {}), approvalRequests: true }, 40000); }
    catch (e) { this.close(); throw e; }
  }
  async run(text, savedId, usageContext) {
    if(usageContext)this.usageContext={...this.usageContext,...usageContext};
    const sessionId = savedId || `session-${randomUUID()}`;
    if (savedId && !this.opened.has(savedId)) await this.client.request('session/resume', { sessionId }, 30000);
    this.currentSessionId = sessionId;
    this.terminalReasons.delete(sessionId);
    await this.client.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text }] }, 30000);
    this.opened.add(sessionId);
    // session/wait reports that the SDK is idle, including failed turns. Only
    // the durable turn/end event says whether the model actually completed.
    const done = this.client.request('session/wait', { sessionId }, 600000).then(result => {
      const reason = this.terminalReasons.get(sessionId);
      if (reason?.kind !== 'completed') {
        const error = Error(reason?.kind === 'max-tokens'
          ? '回答达到长度上限，请缩小内容后重试'
          : reason?.error?.message || (reason?.kind === 'aborted' ? 'Agent 已停止回答' : 'Agent 未完成回答，请重试'));
        error.code = reason?.error?.code || (reason?.kind === 'max-tokens' ? 'OUTPUT_LIMIT' : 'AGENT_TURN_FAILED');
        error.status = reason?.error?.status;
        throw error;
      }
      return result;
    });
    return { sessionId, done };
  }
  close() { this.client?.close(); this.client = null;this.connection?.close();this.connection=null; }
  async shutdown() { try { await this.client?.request('shutdown', {}, 10000); } finally { await this.connection?.flush();this.close(); } }
}
