import { randomUUID } from 'node:crypto';

export function topicTitle(question = '') {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  const text = cleaned.match(/^.*?[？。！]/)?.[0] || cleaned;
  return text ? Array.from(text).slice(0, 28).join('') + (Array.from(text).length > 28 ? '…' : '') : '新对话';
}
export function newConversation(provider = "builtin") {
  const now = new Date().toISOString();
  return { id: randomUUID(), provider, title: '新对话', titleEdited: false, createdAt: now, updatedAt: now,
    threadId: null, messages: [], requests: [], draft: '', model: null, effort: null, modelPreferences: {}, agentSessions: {} };
}
export function checkpointConversation(state) {
  const c = state.conversations?.find(c => c.id === state.activeConversationId);
  if (c) Object.assign(c, { threadId: state.threadId, messages: state.messages, requests: state.requests });
}
export function selectConversation(state, id) {
  const c = state.conversations.find(c => c.id === id);
  if (!c) throw Error('对话不存在');
  checkpointConversation(state);
  state.activeConversationId = c.id;
  state.threadId = c.threadId;
  state.messages = c.messages;
  state.requests = c.requests;
  return c;
}
export function migrateConversations(state) {
  if (!state.conversations?.length) {
    const c = newConversation('codex');
    Object.assign(c, { threadId: state.threadId || null, messages: state.messages || [], requests: state.requests || [] });
    c.title = topicTitle(c.messages.find(m => m.role === 'user')?.text);
    state.conversations = [c];
    state.activeConversationId = c.id;
  }
  for (const c of state.conversations) {
    c.provider ||= "codex";
    c.model ??= null; c.effort ??= null; c.modelPreferences ||= {};
    c.agentSessions ||= {};
    c.agentSessions[c.provider] ||= { threadId: c.threadId || null, seenMessages: c.messages.length };
    let req;
    for (const m of c.messages) {
      m.provider ||= c.provider;
      if (m.role === 'user') req = c.requests.find(r => r.requestId === m.id);
      // Legacy messages were stored in turn order; preserve their original request anchors.
      const source = c.requests.find(r => r.requestId === m.requestId || (m.turnId && r.turnId === m.turnId)) || req;
      if (source) {
        m.requestId ||= source.requestId;
        if (source.blockId) m.anchor ||= { ...source };
      }
      if (m.role === 'assistant' && m.complete === undefined) m.complete = true;
    }
    for (const r of c.requests) if (r.status === 'running') r.status = 'interrupted';
  }
  // After JSON deserialization, reattach the active aliases to the canonical conversation.
  const c = state.conversations.find(c => c.id === state.activeConversationId) || state.conversations[0];
  state.activeConversationId = c.id;
  state.threadId = c.threadId;
  state.messages = c.messages;
  state.requests = c.requests;
}
export function bindAnswer(state, message, turnId) {
  const req = state.requests.find(r => r.turnId === turnId)
    || state.requests.findLast(r => r.status === 'running');
  if (req) {
    req.turnId ||= turnId;
    message.requestId = req.requestId;
    message.provider = req.provider;
    message.model = req.model || null; message.effort = req.effort || null;
    if (req.blockId) message.anchor = { ...req };
  }
  return message;
}
export function recordAgentTurn(state) {
  const c = state.conversations.find(c => c.id === state.activeConversationId);
  c.agentSessions[c.provider] = { threadId: state.threadId, seenMessages: state.messages.length, model: c.model, effort: c.effort, modelPreferences: c.modelPreferences };
}
export function switchConversationAgent(state, provider) {
  checkpointConversation(state);
  const c = state.conversations.find(c => c.id === state.activeConversationId);
  c.agentSessions[c.provider] = { ...c.agentSessions[c.provider], threadId: state.threadId, model: c.model, effort: c.effort, modelPreferences: c.modelPreferences };
  const saved = c.agentSessions[provider];
  c.provider = provider; c.threadId = state.threadId = saved?.threadId || null;
  c.model = saved?.model || null; c.effort = saved?.effort || null; c.modelPreferences = saved?.modelPreferences || {};
}
export function handoffContext(conversation) {
  const seen = conversation.agentSessions?.[conversation.provider]?.seenMessages || 0;
  const unseen = conversation.messages.slice(seen, -1);
  // Only hand off messages from a different runtime; native same-runtime history
  // is resumed by that runtime. Bound the bridge without copying full papers.
  if (!unseen.some(m => m.provider && m.provider !== conversation.provider)) return null;
  let remaining = 18000;
  const messages = [];
  for (const m of unseen.slice(-16).reverse()) {
    if (remaining <= 0) break;
    const text = m.text.slice(-Math.min(6000, remaining)); remaining -= text.length;
    messages.unshift({ role: m.role, provider: m.provider || 'previous', text });
  }
  return { messages, truncated: unseen.length > messages.length || remaining <= 0, note: 'Conversation carried from another Agent. Treat previous answers as context, not verified source evidence. Paper tools remain available.' };
}

// Offsets refer to the displayed message, whose Markdown and equations have been rendered.
export function chatExcerpt(value, messages) {
  const source = messages.find(m => m.id === value?.messageId);
  if (!source || source.phase === 'commentary' || (source.role === 'assistant' && !source.complete))
    throw Error('找不到所选消息，请重新划选');
  if (typeof value.text !== 'string' || !value.text.trim() ||
      !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || value.start < 0 || value.end <= value.start)
    throw Error('选文无效，请重新划选');
  return { messageId: source.id, text: value.text, start: value.start, end: value.end };
}

export function chatExcerpts(values, messages) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw Error('引用格式无效');
  return values.map(value => chatExcerpt(value, messages));
}
