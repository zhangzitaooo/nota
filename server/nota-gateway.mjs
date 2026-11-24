// Deploy this service separately. Its upstream key must never ship with Nota.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { NOTA_MODEL, NOTA_MODEL_NAME } from './agent-config.mjs';
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function createNotaGateway({ apiKey, clients, ledgerFile, upstream = 'https://api.deepseek.com/anthropic/v1/messages', fetchImpl = fetch, now = Date.now,
  maxBodyBytes = 2 * 1024 * 1024, globalDailyBudget = 1000000, requestsPerMinute = 12, clientDailyBudget = 200000 }) {
  if (!apiKey || !ledgerFile || !clients?.length) throw Error('Gateway operator configuration is incomplete');
  mkdirSync(dirname(ledgerFile), { recursive: true, mode: 0o700 });
  let ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {};
  const rates = new Map(), active = new Map(); let totalActive = 0;
  const persist = () => { writeFileSync(ledgerFile + '.tmp', JSON.stringify(ledger), { mode: 0o600 }); renameSync(ledgerFile + '.tmp', ledgerFile); };
  return http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    const reject = (status, message) => json(status, { error: { type: 'nota_gateway_error', message } });
    // No CORS and no URLs chosen by the caller. These tokens have independent,
    // bounded quotas; they are not the upstream DeepSeek credential.
    const token = String(req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer /i, '') || '');
    const client = token.length >= 32 && token.length <= 512 ? clients.find(c => c.tokenHash === tokenHash(token) && !c.disabled && (!c.expiresAt || now() < Date.parse(c.expiresAt))) : null;
    if (!client) return reject(401, 'Nota Agent 访问凭据无效或已过期');
    const path = req.url?.replace(/^\/anthropic(?=\/)/, '');
    if (req.method === 'GET' && path === '/models') return json(200, { data: [{ id: NOTA_MODEL, name: NOTA_MODEL_NAME, input_modalities: ['text', 'image'] }] });
    if (req.method !== 'POST' || path !== '/v1/messages') return reject(404, '无此服务');
    if (!/^application\/json(?:;|$)/.test(req.headers['content-type'] || '')) return reject(415, '需要 JSON');
    const stamp = now(), recent = (rates.get(client.id) || []).filter(t => t > stamp - 60000);
    if (recent.length >= requestsPerMinute || (active.get(client.id) || 0) >= 2 || totalActive >= 8) return reject(429, '请求过于频繁，请稍后重试');
    recent.push(stamp); rates.set(client.id, recent);
    active.set(client.id, (active.get(client.id) || 0) + 1); totalActive++;
    const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) { reject(413, '本次资料过大，请缩小选区'); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      if (input.model !== NOTA_MODEL) return reject(400, 'Nota Agent 仅支持 DeepSeek V4.1 Flash');
      if (!Array.isArray(input.messages) || !input.messages.length) return reject(400, '消息不能为空');
      const maxTokens = Math.min(8192, Math.max(1, Number.isSafeInteger(input.max_tokens) ? input.max_tokens : 8192));
      const tools = input.tools || [];
      if (!Array.isArray(tools) || tools.length > 128 || tools.some(t => t.type && !['custom', 'web_search_20250305'].includes(t.type))) return reject(400, '工具配置无效');
      const allowed = ['messages', 'system', 'tool_choice', 'temperature', 'top_p', 'thinking', 'output_config', 'stream'];
      const body = Object.fromEntries(allowed.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
      body.model = NOTA_MODEL; body.max_tokens = maxTokens;
      if (tools.length) body.tools = tools.map(t => t.type === 'web_search_20250305' ? { ...t, max_uses: Math.min(2, Number(t.max_uses) || 2) } : t);
      // Reserve conservatively before dispatch, with a persistent daily ledger.
      // Crashes/restarts cannot reset the allowance or replay a free reservation.
      const reservation = size + maxTokens + (tools.some(t => t.type === 'web_search_20250305') ? 20000 : 0);
      const day = new Date(stamp).toISOString().slice(0, 10);
      if (ledger.day !== day) ledger = { day, total: 0, clients: {} };
      if (ledger.total + reservation > globalDailyBudget || (ledger.clients[client.id] || 0) + reservation > Math.min(clientDailyBudget, client.dailyBudget || clientDailyBudget)) return reject(429, '今日免费额度已用完，请明天再试或切换本机 Agent');
      ledger.total += reservation; ledger.clients[client.id] = (ledger.clients[client.id] || 0) + reservation; persist();
      const response = await fetchImpl(upstream, { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]), headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      if (!response.ok) { await response.body?.cancel(); return reject(502, 'Nota Agent 服务暂时不可用'); }
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type')?.startsWith('text/event-stream') ? 'text/event-stream' : 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      if (response.body) {
        const stream = Readable.fromWeb(response.body);
        await new Promise((done, fail) => { stream.on('error', fail); res.once('error', fail); res.once('close', done); res.once('finish', done); stream.pipe(res); });
      } else res.end();
    } catch (e) { if (!res.headersSent) reject(e instanceof SyntaxError ? 400 : 502, e instanceof SyntaxError ? 'JSON 格式无效' : 'Nota Agent 服务暂时不可用'); else res.destroy(); }
    finally { active.set(client.id, Math.max(0, (active.get(client.id) || 1) - 1)); totalActive--; }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apiKey = process.env.NOTA_UPSTREAM_KEY_FILE ? readFileSync(process.env.NOTA_UPSTREAM_KEY_FILE, 'utf8').trim() : process.env.NOTA_UPSTREAM_API_KEY;
  const clients = JSON.parse(readFileSync(process.env.NOTA_CLIENTS_FILE, 'utf8'));
  createNotaGateway({ apiKey, clients, ledgerFile: process.env.NOTA_LEDGER_FILE || '/var/lib/nota-agent/usage.json' })
    .listen(Number(process.env.NOTA_GATEWAY_PORT || 8788), process.env.NOTA_GATEWAY_BIND || '127.0.0.1');
}
