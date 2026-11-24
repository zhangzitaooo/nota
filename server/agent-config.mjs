import { inspectWorkBuddy } from './workbuddy.mjs';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JsonlClient } from './jsonl-client.mjs';
import { gatewayHeaders, localGatewayConnection } from './nota-relay.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
export const NOTA_MODEL = 'deepseek-flash';
export const NOTA_MODEL_NAME = 'DeepSeek V4.1 Flash';
const trialGateway = 'https://nota-agent-gateway.zhangzitao997.chatgpt.site/anthropic';
function trialConnection(dir) {
  const folder = join(dir, 'credentials');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, 'trial-token');
  if (!existsSync(file)) {
    const token = 'nota-trial-v1-' + randomBytes(32).toString('hex');
    const staged = join(folder, '.trial-' + randomBytes(12).toString('hex'));
    writeFileSync(staged, token, { mode: 0o600, flag: 'wx' });
    try { linkSync(staged, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { unlinkSync(staged); }
  }
  const token = readFileSync(file, 'utf8').trim();
  if (!/^nota-trial-v1-[a-f0-9]{64}$/.test(token)) throw Error('Nota Agent 本机试用凭据损坏');
  return { baseURL: trialGateway, token, serviceToken: '' };
}
export async function builtinConnection(dir) {
  let config = {};
  try { config = JSON.parse(readFileSync(join(dir, 'agent-gateway.json'), 'utf8')); } catch {}
  const value = process.env.NOTA_AGENT_GATEWAY_URL || config.url;
  if (!value) return trialConnection(dir);
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw Error('Nota Agent 网关必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw Error('Nota Agent 网关地址无效');
  let token = process.env.NOTA_AGENT_TOKEN || '';
  const tokenFile = process.env.NOTA_AGENT_TOKEN_FILE || config.tokenFile;
  if (!token && tokenFile) token = readFileSync(tokenFile, 'utf8').trim();
  if (!token && process.platform === 'darwin') {
    try { token = (await exec('/usr/bin/security', ['find-generic-password', '-s', 'Nota Agent Gateway', '-a', 'nota', '-w'], { timeout: 5000 })).stdout.trim(); } catch {}
  }
  let serviceToken = '';
  const serviceTokenFile = process.env.NOTA_AGENT_SERVICE_TOKEN_FILE || config.serviceTokenFile;
  if (serviceTokenFile) serviceToken = readFileSync(serviceTokenFile, 'utf8').trim();
  if (serviceToken && !url.hostname.endsWith('.chatgpt.site')) throw Error('Nota Agent 私有服务凭证仅可发送到受信任网关');
  return token ? { baseURL: value.replace(/\/+$/, ''), token, serviceToken } : null;
}
export async function builtinRuntimeConnection(dir, options = {}) {
  if (!await builtinConnection(dir)) return null;
  return localGatewayConnection(options.key || dir, () => builtinConnection(dir), options);
}
export function dshLaunch() {
  return { node: process.env.PAPER_DSH_NODE_BIN || join(root, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    cli: process.env.PAPER_DSH_CLI || join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') };
}
export async function builtinStatus(dir) {
  const launch = dshLaunch(); const installed = existsSync(launch.node) && existsSync(launch.cli);
  return { installed, signedIn: Boolean(await builtinConnection(dir)), builtin: true };
}
const cache = new Map();
export function invalidateModels(provider) { cache.delete(provider); }
export async function modelCatalog(provider, dir, refresh = false) {
  if (!refresh && cache.get(provider)?.expires > Date.now()) return cache.get(provider).value;
  let models;
  if (provider === 'codex') {
    const client = new JsonlClient(process.env.CODEX_BIN || 'codex', ['app-server', '--stdio']);
    try {
      await client.request('initialize', { clientInfo: { name: 'nota_models', version: '1.0' }, capabilities: { experimentalApi: true } });
      client.send({ method: 'initialized', params: {} });
      const all = []; let cursor;
      do { const result = await client.request('model/list', { includeHidden: false, cursor }); all.push(...(result.data || [])); cursor = result.nextCursor; } while (cursor);
      models = all.filter(m => !m.hidden).map(m => ({ id: m.model || m.id, name: m.displayName || m.model, default: !!m.isDefault,
        efforts: (m.supportedReasoningEfforts || []).map(e => ({ id: e.reasoningEffort, name: e.reasoningEffort })), defaultEffort: m.defaultReasoningEffort || null,
        vision: m.inputModalities?.includes('image') || false }));
    } finally { client.close(); }
  } else if (provider === 'workbuddy') {
    models = (await inspectWorkBuddy()).models;
  } else if (provider === 'claude') {
    const client = new JsonlClient(process.env.CLAUDE_BIN || 'claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user', '--settings', '{"disableAllHooks":true}']);
    try {
      const result = await client.request('initialize', {}, 20000, true);
      models = (result.models || result.supportedModels || []).map(m => ({ id: m.value, name: m.displayName || m.value, resolvedModel: m.resolvedModel,
        default: m.value === 'default', efforts: (m.supportedEffortLevels || []).map(id => ({ id, name: id })), defaultEffort: null }));
    } finally { client.close(); }
  } else if (provider === 'builtin') {
    const connection = await builtinConnection(dir); if (!connection) throw Error('Nota Agent 暂未开通，请先使用本机 Agent');
    const r = await fetch(connection.baseURL + '/models', { redirect: 'error', headers: gatewayHeaders(connection), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error(r.status === 401 ? 'Nota Agent 访问凭据已失效' : 'Nota Agent 暂时不可用');
    const data = await r.json();
    if (!data.data?.some(m => m.id === NOTA_MODEL)) throw Error('Nota Agent Flash 模型暂不可用');
    models = [{ id: NOTA_MODEL, name: NOTA_MODEL_NAME, default: true,
      efforts: ['off', 'low', 'high', 'max'].map(id => ({ id, name: id })), defaultEffort: 'high', vision: true }];
  } else throw Error('此 Agent 尚未接入');
  if (!models?.length) throw Error('此 Agent 没有返回可用模型，请重新检测');
  cache.set(provider, { value: models, expires: Date.now() + 300000 }); return models;
}
export function chooseConfig(models, conversation, input = {}) {
  const id = input.model ?? conversation.model;
  const model = id ? models.find(m => m.id === id) : models.find(m => m.default) || models[0];
  if (!model) throw Error('模型已不可用，请重新选择');
  const saved = conversation.modelPreferences?.[model.id];
  const effort = input.effort !== undefined ? input.effort : id === conversation.model ? conversation.effort ?? saved ?? model.defaultEffort : saved ?? model.defaultEffort;
  if (effort && !model.efforts.some(e => e.id === effort)) throw Error('此模型不支持该推理强度');
  return { model: model.id, effort: effort || null };
}
