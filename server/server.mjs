import {createQuestionQuota} from './question-quota.mjs';
import {recordUsage,nativeUsage,gatewayUsage,readUsage,usageReport,recordCodexUsage,finishNativeUsage} from './usage.mjs';
import {builtinConnection} from './agent-config.mjs';
import {gatewayHeaders} from './nota-relay.mjs';
import { closeGatewayRelays } from './nota-relay.mjs';
import { chatExcerpt, chatExcerpts, migrateConversations, checkpointConversation, selectConversation, newConversation, topicTitle, bindAnswer, recordAgentTurn, switchConversationAgent, handoffContext } from "./conversations.mjs";
import { prepareEnvironment, turnContext, readingInstructions } from "./paper-environment.mjs";
import { modelCatalog, chooseConfig } from "./agent-config.mjs";
import { ApprovalBroker } from "./approval-broker.mjs";
import { DeepSeekRuntime } from "./deepseek.mjs";
import { runClaude, runWorkBuddy } from "./claude.mjs";
import { agentStatus, discoverAgents, providerStatus, agentProviders } from "./agent-status.mjs";
import { validateAnchor } from "./anchors.mjs";
import { validateReadingPosition } from "./reading.mjs";
import http from "node:http";
import { createImporter } from "./oxr.mjs";
import { downloadPaper } from "./paper-download.mjs";
import { createTranslations } from "./translation.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  appendFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, extname } from "node:path";
import { randomUUID } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.PAPER_DATA_DIR ||
  join(process.env.HOME, "Documents/PaperReadingWorkbench/v2");
const questionQuota = createQuestionQuota(dataDir);
const webDir = resolve(root, "../dist");
const settingsPath = join(dataDir, "settings.json");
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : { defaultAgent: "builtin" };
const selectedProvider = () => state.conversations.find(c => c.id === state.activeConversationId)?.provider || settings.defaultAgent;
let nativeSessionProcess = null, deepseekRuntime = null, activeEnvironment = null;
const activeConversation = () => state.conversations.find(c => c.id === state.activeConversationId);
const mcpFile = join(root, "paper-mcp.mjs");
const mcpConfig = () => ({ nota: { command: process.execPath, args: [mcpFile, activeEnvironment.manifest] } });
const approvals = new ApprovalBroker(() => broadcast());
function activity(kind, label) { state.activity = { kind, label }; broadcast(); }

mkdirSync(dataDir, { recursive: true });
const statePath = join(dataDir, "state.json");
const readingPath = join(dataDir, "reading.json");
const readingPositions = existsSync(readingPath)
  ? JSON.parse(readFileSync(readingPath, "utf8"))
  : {};
const historyPath = join(dataDir, "library-history.json");
const readingHistory = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
function touchReading(id) {
  readingHistory[id] = new Date().toISOString();
  writeFileSync(historyPath + ".tmp", JSON.stringify(readingHistory));
  renameSync(historyPath + ".tmp", historyPath);
}
const readingSequences = new Map();
const lockPath = join(dataDir, "service.lock");
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive)
    throw Error(
      "This data directory is already open in another workbench process",
    );
  unlinkSync(lockPath);
}
writeFileSync(lockPath, String(process.pid), { flag: "wx" });
process.on("exit", () => {
  if (
    existsSync(lockPath) &&
    readFileSync(lockPath, "utf8") === String(process.pid)
  )
    unlinkSync(lockPath);
});
const fixture = { id: "empty", version: 1, title: "", pages: [], blocks: [] };
let state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {
      threadId: null,
      messages: [],
      annotations: [],
      requests: [],
      stats: { deltas: 0, saves: 0, resumes: 0 },
      events: [],
    };
if (!state.conversations && existsSync(statePath) && !existsSync(statePath + ".before-topics.json"))
  writeFileSync(statePath + ".before-topics.json", readFileSync(statePath), { flag: "wx" });
if (!existsSync(statePath)) { const c = newConversation(settings.defaultAgent); state.conversations = [c]; state.activeConversationId = c.id; }
migrateConversations(state);
state.connection = "disconnected";
state.busy = false;
state.activeTurn = null;
state.error = null;
for (const r of state.requests)
  if (r.status === "running") r.status = "interrupted";
let paper = state.paper || fixture;
state.paper = paper;
const clients = new Set();
let child = null,
  sequence = 0,
  pending = new Map(),
  connecting = null;
const persist = () => {
  checkpointConversation(state);
  writeFileSync(statePath + ".tmp", JSON.stringify(state, null, 2));
  renameSync(statePath + ".tmp", statePath);
};
const view = () => {
  const { paper: storedPaper, conversations, ...rest } = state;
  return {
    ...rest,
    approvals: approvals.list(),
    conversations: conversations.map(({ id, title, updatedAt, draft, draftExcerpts, provider, model, effort }) => ({ id, title, updatedAt, draft, draftExcerpts, provider, model, effort })),
    settings,
    paper: paper,
    readingPosition: readingPositions[paper.id] || null,
    translation: translations.get(paper),
    translationActive: translations.active,
    importJob: importer.job,
    library: importer.library().map((p) => {
      const t = translations.get(p);
      const saved = readingPositions[p.id];
      return { ...p, lastReadAt: readingHistory[p.id] || null,
        readingPosition: saved?.documentVersion === p.version ? saved : null,
        translation: t ? { status: t.status, completed: t.completed, total: t.total } : null };
    }).sort((a, b) => (b.lastReadAt || b.importedAt).localeCompare(a.lastReadAt || a.importedAt)) ,
  };
};
const broadcast = () => {
  persist();
  const s = `data: ${JSON.stringify(view())}\n\n`;
  for (const c of clients) c.write(s);
};
const event = (type, details = {}) => {
  const e = { at: new Date().toISOString(), type, ...details };
  state.events.push(e);
  state.events = state.events.slice(-50);
  appendFileSync(join(dataDir, "events.jsonl"), JSON.stringify(e) + "\n");
};
function send(message) {
  if (!child?.stdin.writable) throw Error("Codex 已断开");
  child.stdin.write(JSON.stringify(message) + "\n");
}
function rpc(method, params = {}, timeout = 60000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`${method} 超时`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    try {
      send({ id, method, params });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}
const instructions = readingInstructions;

async function incoming(m) {
  if (m.id !== undefined && !m.method) {
    const job = pending.get(m.id);
    if (!job) return;
    pending.delete(m.id);
    clearTimeout(job.timer);
    m.error ? job.reject(Error(m.error.message)) : job.resolve(m.result);
    return;
  }
  const p = m.params || {};
  if (m.id !== undefined) {
    if (p.threadId && p.threadId !== state.threadId) return;
    if (/requestApproval$/.test(m.method || '')) {
      const allowed = await approvals.request('codex', p.command || p.reason || m.method, p.reason);
      if (m.method === 'item/permissions/requestApproval')
        send({ id: m.id, result: { permissions: allowed ? Object.fromEntries(Object.entries(p.permissions || {}).filter(([,v]) => v != null)) : {}, scope: 'turn' } });
      else send({ id: m.id, result: { decision: allowed ? 'accept' : 'decline' } });
    } else { event('rpc.unsupported', { method: m.method, fields: Object.keys(p) }); send({ id: m.id, error: { code: -32601, message: 'Unsupported host request' } }); }
    return;
  }
  if (m.method === 'item/started') {
    const kind = p.item?.type;
    if (kind === 'commandExecution') activity('bash', '正在运行代码…');
    if (kind === 'webSearch') activity('search', '正在搜索资料…');
    if (kind === 'mcpToolCall') activity('paper', '正在读取资料…');
  }
  if (p.threadId && p.threadId !== state.threadId) return;
  if(m.method==='thread/tokenUsage/updated'){
    const req=state.requests.findLast(r=>r.turnId===p.turnId);
    if(req)recordCodexUsage(dataDir,{paperId:req.paperId,purpose:'chat',operationId:req.requestId,threadId:p.threadId,turnId:p.turnId,model:req.model},p.tokenUsage);
  }
  if (m.method === "turn/started") {
    state.activeTurn = p.turn.id;
    const req = state.requests.findLast(r => r.status === "running");
    if (req) req.turnId = p.turn.id;
    event("turn.started", { turnId: p.turn.id });
    broadcast();
  }
  if (m.method === "item/agentMessage/delta") {
    let msg = state.messages.find((x) => x.id === p.itemId);
    if (!msg) {
      msg = bindAnswer(state, { id: p.itemId, role: "assistant", text: "", turnId: p.turnId, complete: false }, p.turnId);
      state.messages.push(msg);
    }
    msg.text += p.delta;
    state.stats.deltas++;
    event("message.delta", { itemId: p.itemId, chars: p.delta.length });
    broadcast();
  }
  if (m.method === "item/completed" && p.item?.type === "agentMessage") {
    const item = p.item;
    let msg = state.messages.find((x) => x.id === item.id);
    if (!msg) {
      msg = bindAnswer(state, { id: item.id, role: "assistant", text: "", turnId: p.turnId, complete: false }, p.turnId);
      state.messages.push(msg);
    }
    msg.text = item.text;
    msg.phase = item.phase;
    msg.complete = true;
    broadcast();
  }
  if (m.method === "turn/completed") {
    state.busy = false;
    state.activeTurn = null; state.activity = null; approvals.cancel();
    const req = state.requests.findLast((r) => r.status === "running");
    if (req) {req.status = p.turn.status;finishNativeUsage(dataDir,{provider:"codex",operationId:req.requestId,paperId:req.paperId,purpose:"chat",model:req.model,status:p.turn.status});}
    recordAgentTurn(state);
    state.error = p.turn.error?.message || null;
    if (
      !state.error &&
      req?.saveToAnnotation &&
      !state.annotations.some((n) => n.requestId === req.requestId)
    )
      state.error = "回答完成，但 Agent 未成功写入批注。";
    event("turn.completed", { turnId: p.turn.id, status: p.turn.status });
    broadcast();
  }
  if (m.method === "error") {
    state.error = p.error?.message || JSON.stringify(p);
    event("agent.error", { error: state.error });
    broadcast();
  }
}

async function connect(config = activeConversation()) {
  activeEnvironment ||= prepareEnvironment(dataDir, importer.papersDir, paper, translations.get(paper));
  if (selectedProvider() === 'builtin') {
    const c = config;
    const signature = JSON.stringify([paper.id, c.model, c.effort]);
    if (deepseekRuntime?.signature === signature && deepseekRuntime.client && !deepseekRuntime.client.closed) return;
    if (deepseekRuntime) await deepseekRuntime.shutdown();
    state.connection = 'connecting'; broadcast();
    const streams = new Map();
    const runtime = new DeepSeekRuntime({ dataDir, environment: activeEnvironment, model: c.model, effort: c.effort, mcpFile, usageContext:{paperId:paper.id,purpose:'chat'},
      onStream: ({ sessionId, frame }) => {
        if (state.threadId && sessionId !== state.threadId) return;
        const req = state.requests.findLast(r => r.status === 'running'); if (!req) return;
        if (frame.type === 'start') streams.set(frame.attemptId, { turn: frame.turn, step: frame.step, id: `live-${randomUUID()}` });
        const stream = streams.get(frame.attemptId); if (!stream) return;
        if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
          let msg = state.messages.find(m => m.id === stream.id);
          if (!msg) { msg = bindAnswer(state, { id: stream.id, role: 'assistant', text: '', complete: false }, req.requestId); state.messages.push(msg); }
          msg.text += frame.chunk.text; state.stats.deltas++; broadcast();
        }
        if (frame.type === 'end') {
          if (frame.outcome.kind === 'abandoned' || frame.outcome.eventType === 'assistant/attempt') state.messages = activeConversation().messages = state.messages.filter(m => m.id !== stream.id);
          streams.delete(frame.attemptId); broadcast();
        }
      },
      approve: (...args) => approvals.request(...args), onEvent: ({ sessionId, event: ev }) => {
        if (state.threadId && sessionId !== state.threadId) return;
        const req = state.requests.findLast(r => r.status === 'running'); if (!req) return;
        if (ev.type === 'tool/call') activity(ev.data.name, /search|fetch/.test(ev.data.name) ? '正在搜索资料…' : /bash/.test(ev.data.name) ? '正在运行代码…' : '正在读取资料…');
        if (ev.type === 'assistant/message') {
          const item = ev.data.message;
          const stream = [...streams.values()].find(s => s.turn === ev.data.turn && s.step === ev.data.step);
          let msg = state.messages.find(m => m.id === item.id || m.id === stream?.id);
          if (!msg) { msg = bindAnswer(state, { id: item.id, role: 'assistant', text: '', model: req.model, effort: req.effort }, req.requestId); state.messages.push(msg); }
          msg.id = item.id;
          msg.text = (item.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          const calls = (item.content || []).filter(part => part.type === 'tool-call');
          msg.phase = calls.length ? 'commentary' : 'final_answer';
          if (calls.length) msg.toolLabels = calls.map(call => {
            const name = String(call.toolName || call.name || '');
            if (/search|fetch/i.test(name)) return '搜索资料';
            if (/read|figure/i.test(name)) return '读取资料';
            if (/bash|exec/i.test(name)) return '运行命令';
            return name || '调用工具';
          });
          msg.complete = true; broadcast();
        }
      } });
    runtime.signature = signature; deepseekRuntime = runtime;
    try { await runtime.start(); state.connection = 'connected'; state.model = c.model; broadcast(); }
    catch (e) { state.connection = 'disconnected'; throw e; }
    return;
  }
  if (selectedProvider() === "claude" || selectedProvider() === "workbuddy") {
    const provider = selectedProvider();
    if (connecting) return connecting;
    connecting = (async () => {
      state.connection = "connecting"; broadcast();
      try {
        const status = await providerStatus(provider);
        if (provider === "workbuddy" && !status.signedIn) throw Error("请在 WorkBuddy 中配置自定义模型后重新检测");
        if (!status.installed) throw Error("未找到 Claude Code，请在设置中重新检测");
        if (!status.signedIn) throw Error("Claude Code 尚未登录，请在终端运行 claude auth login");
        state.connection = "connected"; state.model = provider === "workbuddy" ? "WorkBuddy" : "Claude Code"; broadcast();
      } catch (e) { state.connection = "disconnected"; broadcast(); throw e; }
    })().finally(() => { connecting = null; });
    return connecting;
  }
  if (state.connection === "connected" && child) return;
  if (connecting) return connecting;
  connecting = (async () => {
    state.connection = "connecting";
    state.error = null;
    broadcast();
    const proc = spawn(
      process.env.CODEX_BIN || "codex",
      ["app-server", "--stdio"],
      { cwd: activeEnvironment?.cwd || root, stdio: ["pipe", "pipe", "pipe"] },
    );
    child = proc;
    const stderr = [];
    proc.stderr.on("data", (b) => {
      stderr.push(String(b));
      if (stderr.length > 20) stderr.shift();
    });
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (child !== proc) return;
      try {
        incoming(JSON.parse(line)).catch((e) => {
          state.error = e.message;
          broadcast();
        });
      } catch {}
    });
    proc.on("error", (e) => {
      state.error = e.message;
      state.connection = "disconnected";
      for (const j of pending.values()) {
        clearTimeout(j.timer);
        j.reject(e);
      }
      pending.clear();
      broadcast();
    });
    proc.on("exit", (code) => {
      if (child !== proc) return;
      child = null;
      state.connection = "disconnected";
      state.busy = false;
      for (const j of pending.values()) {
        clearTimeout(j.timer);
        j.reject(Error("Codex 进程退出"));
      }
      pending.clear();
      event("process.exited", { code });
      broadcast();
    });
    try {
      await rpc("initialize", {
        clientInfo: {
          name: "paper_reading_workbench",
          title: "Nota",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      send({ method: "initialized", params: {} });
      const auth = await rpc("account/read", { refreshToken: false });
      state.authType = auth.account?.type || "unknown";
      if (!auth.account && auth.requiresOpenaiAuth)
        throw Error("本机 Codex 尚未登录。请在终端执行 codex login 后重试。");
      const common = {
        cwd: activeEnvironment.cwd,
        model: config.model || undefined,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        config: { web_search: 'live', sandbox_workspace_write: { network_access: true }, mcp_servers: mcpConfig() },
        developerInstructions: instructions,
      };
      let result;
      if (state.threadId) {
        result = await rpc("thread/resume", {
          ...common,
          threadId: state.threadId,
          excludeTurns: true,
        });
        state.stats.resumes++;
        const history = await rpc("thread/turns/list", {
          threadId: state.threadId,
          limit: 50,
          itemsView: "full",
          sortDirection: "asc",
        });
        state.restoredTurns = history.data?.length || 0;
        for (const turn of history.data || []) {
          const req = state.requests.find(r => r.turnId === turn.id);
          if (req && turn.status && turn.status !== "inProgress") req.status = turn.status;
          for (const item of turn.items || [])
            if (item.type === "agentMessage") {
              const old = state.messages.find((x) => x.id === item.id);
              if (old) { old.text = item.text; old.phase = item.phase; old.complete = true; }
              else
                state.messages.push(bindAnswer(state, {
                  complete: true,
                  id: item.id,
                  role: "assistant",
                  text: item.text,
                  turnId: turn.id,
                  phase: item.phase,
                }, turn.id));
            }
        }
        event("thread.resumed", {
          threadId: state.threadId,
          restoredTurns: state.restoredTurns,
        });
      } else {
        result = await rpc("thread/start", {
          ...common,
          ephemeral: false,
        });
        state.threadId = result.thread.id;
        event("thread.created", { threadId: state.threadId });
      }
      state.model = result.model;
      state.connection = "connected";
      state.serverPid = proc.pid;
      broadcast();
    } catch (e) {
      state.error = e.message;
      state.connection = "disconnected";
      proc.kill();
      broadcast();
      throw e;
    }
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}
async function ask(body) {
  if (state.busy || importer.job?.busy) throw Error("请等待当前回答或解析结束");
  if (body.conversationId !== state.activeConversationId) throw Error("对话已切换，请重新提问");
  if (!paper.parser) throw Error("Import a PDF first");
  if (body.paperId !== paper.id || body.documentVersion !== paper.version)
    throw Error("Paper changed");
  const block = paper.blocks.find((b) => b.id === body.blockId);
  if (body.additionalAnchors !== undefined && (!body.blockId || !Array.isArray(body.additionalAnchors)))
    throw Error("引用选文格式无效");
  const excerpts = chatExcerpts(body.excerpts, state.messages);
  const additionalAnchors = body.additionalAnchors?.map(a => validateAnchor(a, paper, translations.get(paper)));
  const anchor = body.blockId
    ? validateAnchor(body, paper, translations.get(paper))
    : { paperId: paper.id, documentVersion: paper.version };
  if (
    typeof body.question !== "string" ||
    !body.question.trim() ||
    body.question.length > 6000
  )
    throw Error("问题为空或过长");
  if (body.clientMessageId && state.requests.some(r => r.requestId === body.clientMessageId))
    throw Error("这条问题已发送");
  let questionConnection, questionId;
  state.busy = true;
  broadcast();
  try {
    const req = {
      ...anchor,
      additionalAnchors,
      ...(excerpts.length ? { excerpts } : {}),
      requestId: randomUUID(),
      ...(typeof body.clientMessageId === "string" && /^[0-9a-f-]{36}$/i.test(body.clientMessageId) ? { requestId: body.clientMessageId } : {}),
      annotationId: randomUUID(),
      question: body.question.trim(),
      provider: selectedProvider(),
      model: activeConversation().model || null, effort: activeConversation().effort || null,
      saveToAnnotation: false,
      status: "running",
    };
    const conversation = state.conversations.find(c => c.id === state.activeConversationId);
    if (!conversation.titleEdited && !state.messages.some(m => m.role === "user")) conversation.title = topicTitle(req.question);
    conversation.updatedAt = new Date().toISOString();
    conversation.draft = "";
    conversation.draftExcerpts = [];
    state.requests.push(req);
    state.messages.push({
      id: req.requestId,
      requestId: req.requestId,
      anchor: block ? anchor : undefined,
      additionalAnchors,
      ...(excerpts.length ? { excerpts } : {}),
      role: "user",
      provider: req.provider,
      text: req.question,
      selectedText: req.translatedText || req.selectedText,
      blockId: block?.id,
      page: block?.page,
    });
    state.error = null;
    req.conversationContext = handoffContext(conversation);
    activeEnvironment = prepareEnvironment(dataDir, importer.papersDir, paper, translations.get(paper));
    broadcast();
    // Persist and echo the user's message before waiting for the local Agent.
    const frozen = { model: req.model, effort: req.effort, modelPreferences: { ...conversation.modelPreferences } };
    Object.assign(req, chooseConfig(await modelCatalog(conversation.provider, dataDir), frozen));
    if (req.status === 'cancelled') throw Error('已停止回答');
    if (conversation.model === frozen.model && conversation.effort === frozen.effort) {
      conversation.model = req.model; conversation.effort = req.effort;
    }
    await connect(req);
    if (req.status === 'cancelled') throw Error('已停止回答');
    if (!req.model) req.model = state.model || null;
    const userMessage = state.messages.find(m => m.id === req.requestId);
    userMessage.model = req.model; userMessage.effort = req.effort;
    const text = turnContext(paper, req, readingPositions[paper.id]);
    const input = [{ type: "text", text }];
    const referencedIds = new Set([anchor, ...(additionalAnchors || [])]
      .flatMap(item => [item, ...(item.continuation || [])]).map(part => part.blockId));
    const assets = [...new Set(paper.blocks.filter(b => b.asset && (referencedIds.has(b.id) ||
      (b.captionId && referencedIds.has(b.captionId)))).map(b => b.asset))];
    for (const asset of assets)
      input.push({
        type: "localImage",
        path: join(importer.papersDir, paper.id, asset),
      });
    event("request.context", {
      requestId: req.requestId,
      paperId: paper.id,
      page: block?.page,
      blockId: block?.id,
      imageAttached: assets.length > 0,
      imageCount: assets.length,
      startOffset: req.startOffset,
      endOffset: req.endOffset,
    });
    if (selectedProvider() === 'builtin') {
      questionId = req.requestId;
      questionConnection = await questionQuota.begin(questionId);
      if (req.status === 'cancelled') throw Error('已停止回答');
      const run = await deepseekRuntime.run(text, state.threadId,{paperId:paper.id,purpose:'chat',operationId:req.requestId, questionMeter:!!questionConnection});
      state.threadId = run.sessionId; req.turnId = req.requestId; state.activeTurn = req.turnId;
      run.done.then(() => {
        if (req.status === 'cancelled') return;
        const answered = state.messages.some(m => m.requestId === req.requestId && m.role === 'assistant' && m.phase === 'final_answer' && m.complete && m.text?.trim());
        if (!answered) throw Error('Agent 未返回回答，请重试');
        req.status = 'completed';
        recordAgentTurn(state);
      }).catch(e => {
        if (req.status !== 'cancelled') { req.status = 'failed'; state.error = e.message; }
      }).finally(async () => {
        await questionQuota.finish(questionConnection, questionId, req.status === 'completed');
        state.busy = false; state.activeTurn = null; state.activity = null; approvals.cancel(); broadcast();
      });
      broadcast(); return { requestId: req.requestId, turnId: req.turnId };
    }
    if (selectedProvider() === "claude" || selectedProvider() === "workbuddy") {
    const provider = selectedProvider();
      const sessionId = state.threadId;
      if (sessionId) state.stats.resumes++;
      const msg = bindAnswer(state, { id: randomUUID(), role: "assistant", text: "", complete: false, phase: "final_answer" }, req.requestId);
      req.turnId = req.requestId; state.activeTurn = req.turnId;
      state.messages.push(msg);
      const run = provider === "workbuddy" ? runWorkBuddy : runClaude;
      const done = run({ cwd: activeEnvironment.cwd, instructions, text, sessionId,
        onUsage: value=>{const usage=nativeUsage(provider,value.usage);if(usage)recordUsage(dataDir,{id:provider+':'+req.requestId,provider,purpose:'chat',operationId:req.requestId,paperId:req.paperId,model:req.model,status:value.is_error?'failed':'completed',usageKnown:true,...usage,startedAt:new Date().toISOString()});},
        model: req.model, effort: req.effort, mcp: mcpConfig(), readDir: activeEnvironment.resourceDir,
        approve: (...args) => approvals.request(...args),
        images: input.filter(i => i.type === "localImage").map(i => i.path),
        onSpawn: proc => { nativeSessionProcess = proc; },
        onEvent: m => {
          if (m.type === "system" && m.subtype === "init") { state.threadId = m.session_id; state.model = m.model; req.resolvedModel = msg.resolvedModel = userMessage.resolvedModel = m.model; if (!req.model) { req.model = m.model; msg.model = m.model; } }
          if (m.type === 'assistant' && m.message?.content?.some(c => c.type === 'tool_use')) {
            const tool = m.message.content.find(c => c.type === 'tool_use').name;
            activity(tool, /Search|Fetch/.test(tool) ? '正在搜索资料…' : /Bash/.test(tool) ? '正在运行代码…' : '正在读取资料…');
          }
          const delta = m.type === "stream_event" && m.event?.type === "content_block_delta" ? m.event.delta : null;
          if (delta?.type === "text_delta") { msg.text += delta.text; state.stats.deltas++; }
          if (m.type === "assistant") msg.text = (m.message?.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
          broadcast();
        }
      });
      done.then(result => {
        msg.text = result.text || msg.text; msg.complete = true;
        state.threadId = result.sessionId; req.status = "completed"; recordAgentTurn(state);
      }).catch(e => { if (req.status !== 'cancelled') { req.status = "failed"; state.error = e.message; } }).finally(() => {
        finishNativeUsage(dataDir,{provider,operationId:req.requestId,paperId:req.paperId,purpose:"chat",model:req.model,status:req.status});
        nativeSessionProcess = null; state.busy = false; state.activeTurn = null; state.activity = null; approvals.cancel(); broadcast();
      });
      broadcast();
      return { requestId: req.requestId, turnId: req.turnId };
    }
    const r = await rpc("turn/start", { threadId: state.threadId, input,
      ...(req.model ? { model: req.model } : {}), ...(req.effort ? { effort: req.effort } : {}),
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [activeEnvironment.cwd], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
    req.turnId = r.turn.id;
    state.activeTurn = state.busy ? r.turn.id : null;
    broadcast();
    return { requestId: req.requestId, turnId: r.turn.id };
  } catch (e) {
    await questionQuota.finish(questionConnection, questionId, false);
    state.busy = false;
    state.error = state.requests.at(-1)?.status === 'cancelled' ? null : e.message;
    const req = state.requests.findLast((r) => r.status === "running");
    if (req) req.status = "failed";
    broadcast();
    throw e;
  }
}
function disconnect() {
  if (connecting) throw Error("Codex is still connecting");
  if (state.busy) throw Error("请先等待回答结束或点击停止");
  approvals.cancel(); deepseekRuntime?.close(); deepseekRuntime = null;
  const proc = child;
  child = null;
  proc?.kill();
  state.connection = "disconnected";
  event("process.disconnected");
  broadcast();
}
const projectsDir = join(dataDir, "projects");
mkdirSync(projectsDir, { recursive: true });
async function activate(next) {
  if (state.busy || connecting)
    throw Error("Codex 正在工作，请结束后再切换论文");
  disconnect();
  writeFileSync(
    join(projectsDir, paper.id + ".json"),
    JSON.stringify(state, null, 2),
  );
  const saved = join(projectsDir, next.id + ".json");
  state = existsSync(saved)
    ? JSON.parse(readFileSync(saved, "utf8"))
    : {
        threadId: null,
        messages: [],
        annotations: [],
        requests: [],
        stats: { deltas: 0, saves: 0, resumes: 0 },
        events: [],
      };
  if (!state.conversations && existsSync(saved) && !existsSync(saved + ".before-topics.json"))
    writeFileSync(saved + ".before-topics.json", readFileSync(saved), { flag: "wx" });
  if (!existsSync(saved)) {
    const c = newConversation(settings.defaultAgent); state.conversations = [c]; state.activeConversationId = c.id;
  }
  migrateConversations(state);
  paper = next; activeEnvironment = null;
  state.paper = paper;
  state.connection = "disconnected";
  state.busy = false;
  state.activeTurn = null;
  state.error = null;
  event("paper.activated", { paperId: paper.id });
  broadcast();
}
const importer = createImporter(root, dataDir, () => broadcast(), activate);
let importDownloading = false;
const translations = createTranslations(root, importer.papersDir, () => broadcast(), () => settings.defaultAgent, dataDir);
async function binaryBody(req) {
  let size = 0;
  const chunks = [];
  for await (const b of req) {
    size += b.length;
    if (size > 30 * 1024 * 1024) throw Error("PDF 不得超过 30MB");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const b of req) {
    size += b.length;
    if (size > 128 * 1024) throw Error("请求过大");
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(obj));
  };
  const host = req.headers.host || "";
  if (!/^127\.0\.0\.1:\d+$/.test(host))
    return json(403, { error: "仅允许本机访问" });
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    return json(403, { error: "跨来源请求被拒绝" });
  try {
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && req.url.startsWith('/api/models?')) {
      const query = new URL(req.url, `http://${host}`).searchParams;
      if (query.get('paperId') !== paper.id || query.get('conversationId') !== state.activeConversationId) throw Error('对话已切换');
      const provider = selectedProvider(); const models = await modelCatalog(provider, dataDir, query.get('refresh') === '1');
      if (query.get('paperId') !== paper.id || query.get('conversationId') !== state.activeConversationId) throw Error('对话已切换');
      if (provider !== selectedProvider()) throw Error('Agent 已切换');
      return json(200, { provider, models });
    }
    if (req.method === 'POST' && req.url === '/api/conversations/agent') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: '需要 JSON' });
      const b = await bodyOf(req);
      if (b.paperId !== paper.id || b.conversationId !== state.activeConversationId) throw Error('对话已切换');
      if (state.busy || connecting) throw Error('请先停止当前回答');
      const status = await providerStatus(b.provider, dataDir);
      if (!status.installed || !status.signedIn) throw Error(b.provider === 'builtin' ? 'Nota Agent 暂未开通' : '请先安装并登录此 Agent');
      if (b.paperId !== paper.id || b.conversationId !== state.activeConversationId || state.busy || connecting) throw Error('对话状态已改变，请重试');
      disconnect(); switchConversationAgent(state, b.provider); state.model = null; state.error = null;
      broadcast(); return json(200, view());
    }
    if (req.method === 'POST' && req.url === '/api/conversations/config') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: '需要 JSON' });
      const b = await bodyOf(req);
      if (b.paperId !== paper.id || b.conversationId !== state.activeConversationId) throw Error('对话已切换');
      const c = activeConversation(), provider = c.provider; const config = chooseConfig(await modelCatalog(provider, dataDir), c, b);
      if (b.paperId !== paper.id || b.conversationId !== state.activeConversationId) throw Error('对话已切换');
      if (provider !== c.provider) throw Error('Agent 已切换');
      Object.assign(c, config); c.modelPreferences[config.model] = config.effort;
      broadcast(); return json(200, view());
    }
    if (req.method === 'POST' && req.url === '/api/approvals') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(415, { error: '需要 JSON' });
      const b = await bodyOf(req);
      if (b.paperId !== paper.id || b.conversationId !== state.activeConversationId || typeof b.allowed !== 'boolean' || !approvals.answer(b.id, b.allowed)) throw Error('授权请求已结束');
      return json(200, { answered: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const paperId=url.searchParams.get('paperId');
      if(paperId&&!/^[a-zA-Z0-9._:-]{1,128}$/.test(paperId))return json(400,{error:'论文标识无效'});
      let cloud=null,syncError=null;
      if(url.searchParams.get('refresh')!=='0')try{
        const connection=await builtinConnection(dataDir);
        if(connection){let cursor=null;const seen=new Set();do{
          const params=new URLSearchParams({limit:'100',...(paperId?{paperId}:{}),...(cursor?{cursor}:{})});
          const r=await fetch(connection.baseURL+'/usage?'+params,{headers:gatewayHeaders(connection),redirect:'error',signal:AbortSignal.timeout(15000)});
          if(!r.ok)throw Error('云端用量暂时不可用');const d=await r.json();cloud={quota:d.quota,legacy:d.legacy};
          for(const row of d.requests||[])recordUsage(dataDir,gatewayUsage(row));cursor=d.nextCursor;if(cursor){if(seen.has(cursor)||seen.size>=20)throw Error('云端用量分页异常');seen.add(cursor);}
        }while(cursor);}
      }catch(e){syncError=e.message;}
      return json(200,{...usageReport(dataDir,paperId),cloud,syncError});
    }
    if (req.method === "GET" && req.url === "/api/settings")
      return json(200, { ...settings, agents: await discoverAgents(dataDir) });
    if (req.method === "POST" && req.url === "/api/settings/agent") {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") return json(415, { error: "需要 JSON" });
      const b = await bodyOf(req);
      if (state.busy || connecting || translations.active) throw Error("请等待当前回答或翻译完成");
      if (!agentProviders.some(p => p.id === b.provider && p.supported)) throw Error("暂不支持此 Agent");
      const status = await providerStatus(b.provider, dataDir);
      if (!status.installed) throw Error("未检测到此 Agent，请重新检测");
      if (!status.signedIn) throw Error('请先完成此 Agent 的登录或凭据配置');
      disconnect();
      settings.defaultAgent = b.provider;
      writeFileSync(settingsPath + ".tmp", JSON.stringify(settings)); renameSync(settingsPath + ".tmp", settingsPath);
      state.model = undefined; state.error = null;
      broadcast(); return json(200, view());
    }
    if (req.method === "GET" && req.url === "/api/agent/status")
      return json(200, await agentStatus());
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'",
      });
      res.end(readFileSync(join(webDir, "index.html")));
      return;
    }
    if (
      req.method === "GET" &&
      /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|ttf|png)$/.test(req.url)
    ) {
      const file = join(webDir, req.url);
      if (!existsSync(file)) return json(404, {error: "无此资源"});
      res.writeHead(200, {
        "Content-Type": {
          ".png": "image/png",
          ".css": "text/css",
          ".js": "text/javascript",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
        }[extname(file)],
        "X-Content-Type-Options": "nosniff",
      });
      res.end(readFileSync(file));
      return;
    }
    if (req.method === "GET" && req.url === "/api/state")
      return json(200, view());
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);
      res.write(`data: ${JSON.stringify(view())}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/papers/")) {
      const parts = url.pathname.split("/");
      const id = parts[2],
        file = parts[3];
      if (
        parts.length !== 4 ||
        !/^paper-[a-f0-9-]+$/.test(id) ||
        !/^(original\.pdf|page-\d+\.png|p\d+-b\d+\.png)$/.test(file)
      )
        return json(404, { error: "无此资源" });
      const dir = join(importer.papersDir, id);
      if (!existsSync(join(dir, "paper.json")))
        return json(404, { error: "文档未就绪" });
      res.writeHead(200, {
        "Content-Type": file.endsWith(".pdf") ? "application/pdf" : "image/png",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      });
      res.end(readFileSync(join(dir, file)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      if (state.busy || connecting || importer.job?.busy || importDownloading)
        throw Error("请等待当前操作结束");
      if (req.headers["content-type"] !== "application/pdf")
        return json(415, { error: "请选择 PDF" });
      const pdf = await binaryBody(req);
      if (state.busy || connecting || importer.job?.busy || importDownloading)
        throw Error("请等待当前操作结束");
      if (!pdf.subarray(0, 1024).includes(Buffer.from("%PDF-")))
        throw Error("文件不是有效 PDF");
      return json(
        202,
        importer.start(
          pdf,
          url.searchParams.get("name")?.slice(0, 200) || "paper.pdf",
          url.searchParams.get("pages") || "all",
        ),
      );
    }
    if (
      req.method === "POST" &&
      req.headers["content-type"]?.split(";")[0] !== "application/json"
    )
      return json(415, { error: "需要 JSON" });
    if (req.method === "POST" && url.pathname === "/api/import/url") {
      if (state.busy || connecting || importer.job?.busy || importDownloading)
        throw Error("请等待当前操作结束");
      importDownloading = true;
      const controller = new AbortController();
      const cancelled = () => { if (!res.writableEnded) controller.abort(); };
      req.once("aborted", cancelled);
      res.once("close", cancelled);
      try {
        const body = await bodyOf(req);
        const { pdf, name } = await downloadPaper(body.url, { signal: controller.signal });
        if (state.busy || connecting || importer.job?.busy)
          throw Error("请等待当前操作结束");
        return json(202, importer.start(pdf, name, "all"));
      } finally {
        importDownloading = false;
        req.off("aborted", cancelled);
        res.off("close", cancelled);
      }
    }
    if (req.method === "POST" && req.url === "/api/import/resume") {
      if (state.busy || connecting) throw Error("请等待对话结束");
      return json(202, importer.resume());
    }
    if (req.method === "POST" && req.url === "/api/import/pause") {
      importer.pause();
      return json(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/translate") {
      if (importer.job?.busy) throw Error("请等待解析结束");
      return json(202, translations.start(paper));
    }
    if (req.method === "POST" && req.url === "/api/translate/pause") {
      translations.pause();
      return json(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/connect") {
      if (importer.job?.busy) throw Error("请等待解析结束");
      await connect();
      return json(200, view());
    }
    if (req.method === "POST" && req.url === "/api/switch") {
      if (importer.job?.busy) throw Error("请等待解析结束");
      const b = await bodyOf(req);
      if (!importer.library().some((p) => p.id === b.paperId))
        throw Error("论文不存在");
      if (b.paperId !== paper.id) await activate(
        JSON.parse(
          readFileSync(join(importer.papersDir, b.paperId, "paper.json")),
        ),
      );
      touchReading(paper.id);
      broadcast();
      return json(200, view());
    }
    if (req.method === "POST" && req.url === "/api/reading-position") {
      const b = await bodyOf(req);
      if (
        typeof b.clientId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(b.clientId) ||
        !Number.isSafeInteger(b.sequence) ||
        b.sequence < 1
      )
        throw Error("阅读记录请求无效");
      const position = validateReadingPosition(
        b.position,
        paper,
        translations.get(paper),
      );
      if ((readingSequences.get(b.clientId) || 0) >= b.sequence)
        return json(200, { stale: true });
      readingSequences.set(b.clientId, b.sequence);
      readingPositions[paper.id] = position;
      touchReading(paper.id);
      writeFileSync(readingPath + ".tmp", JSON.stringify(readingPositions));
      renameSync(readingPath + ".tmp", readingPath);
      return json(200, { saved: true });
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/conversations/")) {
      const b = await bodyOf(req);
      if (b.paperId !== paper.id) throw Error("论文已切换");
      const action = url.pathname.split("/").at(-1);
      const c = state.conversations.find(c => c.id === b.conversationId);
      if (action === "draft") {
        if (!c || typeof b.draft !== "string" || b.draft.length > 6000) throw Error("草稿无效");
        if (b.excerpts !== undefined) c.draftExcerpts = chatExcerpts(b.excerpts, c.messages);
        c.draft = b.draft;
      } else if (action === "comment") {
        if (!c || c.id !== state.activeConversationId) throw Error("对话已切换");
        if (typeof b.body !== "string" || !b.body.trim() || b.body.length > 12000) throw Error("请输入 1–12000 字的评论");
        if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) throw Error("评论编号无效");
        const excerpt = chatExcerpt(b.excerpt, c.messages);
        const source = c.messages.find(m => m.id === excerpt.messageId);
        source.comments ||= [];
        if (!source.comments.some(comment => comment.id === b.id)) {
          source.comments.push({ id: b.id, excerpt, body: b.body.trim() });
        }
      } else if (action === "rename") {
        if (!c || typeof b.title !== "string" || !b.title.trim() || b.title.trim().length > 80) throw Error("请输入 1–80 字的标题");
        c.title = b.title.trim();
        c.titleEdited = true;
      } else if (action === "create" || action === "switch") {
        if (state.busy || connecting || importer.job?.busy) throw Error("请等待当前操作完成后切换对话");
        if (action === "create" && !state.messages.length) return json(200, view());
        if (action === "switch" && !c) throw Error("对话不存在");
        disconnect();
        const next = action === "create" ? newConversation(settings.defaultAgent) : c;
        if (action === "create") state.conversations.push(next);
        selectConversation(state, next.id);
        state.error = null;
        state.activeTurn = null;
      } else throw Error("未知对话操作");
      broadcast();
      return json(200, view());
    }
    if (req.method === "POST" && req.url === "/api/annotations/reply") {
      const b = await bodyOf(req);
      if (b.paperId !== paper.id) throw Error("论文已切换");
      const note = state.annotations.find(n => n.annotationId === b.annotationId);
      if (!note) throw Error("找不到这条批注");
      if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) throw Error("回复编号无效");
      if (typeof b.body !== "string" || !b.body.trim() || b.body.length > 12000) throw Error("请输入 1–12000 字的回复");
      const existing = note.replies?.find(r => r.id === b.id);
      if (existing && existing.body !== b.body.trim()) throw Error("回复内容已变更，请重新发送");
      if (!existing) {
        const reply = { id: b.id, author: "user", body: b.body.trim(), savedAt: new Date().toISOString() };
        (note.replies ??= []).push(reply);
      }
      broadcast();
      return json(existing ? 200 : 201, { id: b.id });
    }
    if (req.method === "POST" && req.url === "/api/annotations") {
      const b = await bodyOf(req);
      const anchor = validateAnchor(b, paper, translations.get(paper));
      if (!["comment", "highlight"].includes(b.kind))
        throw Error("Invalid annotation kind");
      if (
        typeof b.body !== "string" ||
        b.body.length > 12000 ||
        (b.kind === "comment" && !b.body.trim())
      )
        throw Error("Empty or oversized comment");
      const n = {
        ...anchor,
        annotationId: randomUUID(),
        author: "user",
        kind: b.kind,
        body: b.body.trim(),
        savedAt: new Date().toISOString(),
      };
      state.annotations.push(n);
      event("annotation.created", { annotationId: n.annotationId });
      broadcast();
      return json(201, n);
    }
    if (req.method === "GET" && req.url === "/api/question-quota")
      return json(200, await questionQuota.balance());
    if (req.method === "POST" && req.url === "/api/ask")
      return json(200, await ask(await bodyOf(req)));
    if (req.method === "POST" && req.url === "/api/disconnect") {
      disconnect();
      return json(200, view());
    }
    if (req.method === "POST" && req.url === "/api/stop") {
      approvals.cancel();
      const req = state.requests.findLast(r => r.status === 'running');
      if (req) req.status = 'cancelled';
      if (selectedProvider() === 'builtin') { deepseekRuntime?.close(); deepseekRuntime = null; return json(200, { ok: true }); }
      if (nativeSessionProcess) { nativeSessionProcess.kill(); return json(200, { ok: true }); }
      if (state.activeTurn)
        await rpc("turn/interrupt", {
          threadId: state.threadId,
          turnId: state.activeTurn,
        });
      return json(200, { ok: true });
    }
    json(404, { error: "Not found" });
  } catch (e) {
    json(400, { error: e.message });
  }
});
if (process.send)
  server.on("listening", () =>
    process.send({ type: "ready", port: server.address().port }),
  );
const heartbeat = setInterval(() => {
  for (const c of clients) c.write(": heartbeat\n\n");
}, 15000);
function shutdown() {
  void closeGatewayRelays();
  persist();
  importer.close();
  translations.close();
  child?.kill();
  nativeSessionProcess?.kill(); deepseekRuntime?.close(); approvals.cancel();
  clearInterval(heartbeat);
  for (const c of clients) c.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(Number(process.env.PORT || 43128), "127.0.0.1", () =>
  console.log(`Paper workbench: http://127.0.0.1:${server.address().port}`),
);
