import { useEffect, useRef, useState } from "react";
import { anchorKey, quoteText } from "./types";
import { ChatSelection, ChatQuoteChips, excerptKey, locateExcerpt } from "./ChatSelection";
import type { Anchor, Block, ChatExcerpt, Message, Snapshot } from "./types";
import { command } from "./api";
import { Icon } from "./Icon";
import { MessageContent } from "./MessageContent";
import { ModelPicker } from "./ModelPicker";
import { PanelResizer, usePanelWidth } from './PanelResizer';

const providerNames = { builtin: "Nota Agent", codex: "Codex", claude: "Claude Code", workbuddy: "WorkBuddy" };

function messageAnchors(message: Message) {
  return message.anchor ? [message.anchor, ...(message.additionalAnchors || [])] : [];
}

function QuoteChips({ anchors, onLocate, onRemove }: {
  anchors: Anchor[]; onLocate: (a: Anchor) => void; onRemove?: (a: Anchor) => void;
}) {
  if (!anchors.length) return null;
  return <div className="quote-chips" role="group" aria-label="引用选文">
    {anchors.map((anchor, index) => {
      const text = quoteText(anchor);
      return <span className="quote-chip" key={anchorKey(anchor)}>
        <button type="button" className="quote-jump" onClick={() => onLocate(anchor)}
          aria-label={`定位引用 ${index + 1}：${text}`} title={`第 ${anchor.page} 页 · ${text}`}>
          <Icon name="quote" size={13} /><span>{text}</span>
        </button>
        {onRemove && <button type="button" className="quote-remove" aria-label={`移除引用 ${index + 1}`}
          title="移除引用" onClick={() => onRemove(anchor)}><Icon name="close" size={12} /></button>}
      </span>;
    })}
  </div>;
}

export function AgentPanel({ state, anchors, onRemove, onUseAnchors, onState, onLocate, onPreview, onSettings, onClose, onResize }: {
  state: Snapshot; anchors: Anchor[];
  onRemove: (anchor: Anchor) => void; onUseAnchors: (anchors: Anchor[]) => void;
  onState: (state: Snapshot) => void; onLocate: (anchor: Anchor) => void;
  onPreview: (block: Block) => void;
  onSettings: () => void;
  onClose: () => void;
  onResize: (update: () => void) => void;
}) {
  const conversation = state.conversations.find(c => c.id === state.activeConversationId)!;
  const panelWidth = usePanelWidth();
  const scope = { paperId: state.paper.id, conversationId: conversation.id };
  const [error, setError] = useState("");
  const fail = (e: Error) => setError(e.message);
  const [question, setQuestion] = useState(conversation.draft || "");
  const [excerpts, setExcerpts] = useState<ChatExcerpt[]>(conversation.draftExcerpts || []);
  const [sending, setSending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<(Message & { delivery: "sending" | "accepted" | "failed"; failure?: string }) | null>(null);
  const inFlight = useRef(false);
  const [changing, setChanging] = useState(false);
  const [history, setHistory] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [copied, setCopied] = useState<string | null>(null);
  const messages = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draft = useRef({ text: conversation.draft || "", excerpts, dirty: false });
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const historyRoot = useRef<HTMLDivElement>(null);
  const locked = state.busy || sending || changing || state.connection === "connecting";
  const visibleMessages = pendingMessage && !state.messages.some(m => m.id === pendingMessage.id)
    ? [...state.messages, pendingMessage] : state.messages;
  const lastUserIndex = visibleMessages.map(m => m.role).lastIndexOf("user");
  const latestReplies = visibleMessages.slice(lastUserIndex + 1);
  const replyStarted = latestReplies.some(m => m.role === "assistant" && (m.text.trim() || m.toolLabels?.length));
  const answerStarted = latestReplies.some(m => m.role === "assistant" && m.phase !== "commentary" && m.text.trim());
  function flushDraft() {
    clearTimeout(draftTimer.current);
    if (!draft.current.dirty) return;
    draft.current.dirty = false;
    void command("conversations/draft", { ...scope, draft: draft.current.text, excerpts: draft.current.excerpts }).catch(fail);
  }
  useEffect(() => {
    const unload = () => {
      if (draft.current.dirty) navigator.sendBeacon("/api/conversations/draft", new Blob([JSON.stringify({ ...scope, draft: draft.current.text, excerpts: draft.current.excerpts })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", unload);
    return () => { window.removeEventListener("pagehide", unload); flushDraft(); };
  }, []);
  useEffect(() => {
    if (nearBottom.current) messages.current?.scrollTo({ top: messages.current.scrollHeight });
  }, [state.messages, pendingMessage, state.approvals, state.activity]);
  useEffect(() => {
    if (pendingMessage?.delivery === "accepted" && state.messages.some(m => m.id === pendingMessage.id)) setPendingMessage(null);
  }, [pendingMessage, state.messages]);
  useEffect(() => { if (anchors.length) textarea.current?.focus({ preventScroll: true }); }, [anchors]);
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(180, Math.max(44, el.scrollHeight))}px`; }
  }, [question]);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!historyRoot.current?.contains(e.target as Node)) setHistory(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setHistory(false); setRenaming(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);
  function editQuestion(text: string, quotes = draft.current.excerpts) {
    setQuestion(text); setExcerpts(quotes); draft.current = { text, excerpts: quotes, dirty: true };
    clearTimeout(draftTimer.current); draftTimer.current = setTimeout(flushDraft, 350);
  }
  async function changeConversation(action: "create" | "switch", id = conversation.id) {
    if (locked) return;
    if ((action === "create" && !visibleMessages.length) || (action === "switch" && id === conversation.id)) {
      setHistory(false);
      textarea.current?.focus({ preventScroll: true });
      return;
    }
    setChanging(true); flushDraft();
    try {
      const next = await command<Snapshot>(`conversations/${action}`, { ...scope, conversationId: id });
      onUseAnchors([]); setHistory(false); onState(next);
    } catch (e) { fail(e as Error); }
    finally { setChanging(false); }
  }
  async function rename() {
    try {
      const next = await command<Snapshot>("conversations/rename", { ...scope, title });
      onState(next); setRenaming(false);
    } catch (e) { fail(e as Error); }
  }
  async function send(input = question) {
    if (!input.trim() || locked || inFlight.current) return;
    inFlight.current = true;
    const text = input.trim();
    const [anchor, ...extras] = anchors;
    const additionalAnchors = extras.length ? extras : undefined;
    const id = crypto.randomUUID();
    setError(""); setSending(true);
    nearBottom.current = true;
    setPendingMessage({ id, requestId: id, role: "user", text, anchor, additionalAnchors, excerpts, delivery: "sending" });
    setQuestion(""); setExcerpts([]);
    clearTimeout(draftTimer.current);
    draft.current = { text: "", excerpts: [], dirty: false };
    onUseAnchors([]);
    try {
      await command("ask", { ...scope, ...(anchor || { documentVersion: state.paper.version }), additionalAnchors, excerpts, question: text, clientMessageId: id });
      setPendingMessage(m => m?.id === id ? { ...m, delivery: "accepted" } : m);
    } catch (e) {
      setPendingMessage(m => m?.id === id ? { ...m, delivery: "failed", failure: (e as Error).message } : m);
    }
    finally { inFlight.current = false; setSending(false); }
  }
  function restoreFailedMessage(message: Message) {
    editQuestion(message.text, [...new Map([...(message.excerpts || []), ...excerpts].map(e => [excerptKey(e), e])).values()]);
    onUseAnchors([...new Map([...messageAnchors(message), ...anchors].map(a => [anchorKey(a), a])).values()]);
    setPendingMessage(null);
    textarea.current?.focus({ preventScroll: true });
  }
  async function copyAnswer(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); }
    catch { fail(Error("复制失败，请选中文字手动复制")); }
  }
  const providerName = providerNames[conversation.provider];
  const subject = anchors.length > 1 ? "这些选文" : "这段选文";
  const suggestions = anchors.length > 1
    ? ["比较这些选文的观点", "这些选文之间有什么联系？"]
    : anchors.length
    ? ["用通俗的话解释这段", "这段结论有什么依据？"]
    : ["概括这篇论文的核心观点", "作者用什么证据支持结论？"];
  const run = (name: string) => command(name).catch(fail);
  return <aside className="agent-panel" aria-label="Agent 对话" style={{ width: panelWidth.width, maxWidth: 'calc(100vw - 24px)' }}>
    <PanelResizer width={panelWidth.width} onWidth={width => onResize(() => panelWidth.setWidth(width))} onEnd={panelWidth.persist} />
    <header className="panel-header topic-header">
      {renaming ? <form className="topic-rename" onSubmit={e => { e.preventDefault(); void rename(); }}>
        <input autoFocus aria-label="对话标题" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
        <button aria-label="保存标题" disabled={!title.trim()}><Icon name="check" size={16} /></button>
        <button type="button" aria-label="取消修改标题" onClick={() => setRenaming(false)}><Icon name="close" size={16} /></button>
      </form> : <>
        <button className="topic-title" title="修改对话标题" aria-label={`修改对话标题：${conversation.title}`} onClick={() => { setTitle(conversation.title); setRenaming(true); }}>
          <span>{conversation.title}</span><Icon name="edit" size={14} />
        </button>
        <div className="topic-controls" ref={historyRoot}>
          <button title={visibleMessages.length ? "新对话" : "继续在当前新对话提问"} aria-label="新对话" disabled={locked} onClick={() => void changeConversation("create")}><Icon name="compose" size={18} /></button>
          <button title="历史对话" aria-label="历史对话" aria-expanded={history} onClick={() => setHistory(v => !v)}><Icon name="conversations" size={18} /></button>
          <button title="收起 Agent" aria-label="收起 Agent" className="topic-collapse" onClick={onClose}><Icon name="panelRight" size={18} /></button>
          {history && <div className="topic-history" role="dialog" aria-label="历史对话">
            {[...state.conversations].reverse().map(c => <button key={c.id} disabled={locked} aria-current={c.id === conversation.id ? "true" : undefined}
              onClick={() => void changeConversation("switch", c.id)}><Icon name="chat" size={15} /><span>{c.title}</span>{c.id === conversation.id && <Icon name="check" size={14} />}</button>)}
          </div>}
        </div>
      </>}
    </header>
    <div className="agent-messages" ref={messages} role="log" aria-label="对话消息" aria-live="off" onScroll={() => {
      const el = messages.current!; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowLatest(!nearBottom.current);
    }}>
      {!visibleMessages.length && <div className="agent-welcome">
        <img className="welcome-agent-mark" alt="" src={`/assets/nota-agent-${conversation.provider}.png`} />
        <h2>{anchors.length ? `聊聊${subject}` : "聊聊这篇论文"}</h2>
        {!question.trim() && <div className="suggestions" aria-label="建议问题">{suggestions.map(q =>
          <button key={q} type="button" disabled={locked} title={`发送：${q}`} onClick={() => void send(q)}>
            <span>{q}</span><Icon name="arrow" size={14} />
          </button>)}</div>}
      </div>}
      {visibleMessages.map((m, index) => {
        if (m.phase === "commentary") {
          const sameGroup = (other?: Message) => other?.phase === "commentary" && other.requestId === m.requestId;
          if (sameGroup(visibleMessages[index - 1])) return null;
          const steps = [];
          let end = index;
          while (sameGroup(visibleMessages[end])) {
            const step = visibleMessages[end++];
            if (step.text.trim() || step.toolLabels?.length) steps.push(step);
          }
          if (!steps.length) {
            return m.provider === "builtin" ? <div className="process-history-note" key={m.id}>
              <Icon name="check" size={12} />已调用工具 · {end - index} 轮
            </div> : null;
          }
          const active = state.busy && end === visibleMessages.length;
          return <details key={m.id} className="message-process">
            <summary><span className={`process-indicator${active ? " active" : ""}`} aria-hidden="true" />
              <span>{active ? (state.activity?.label || "正在思考…") : "思考过程"}</span>
              {steps.length > 1 && <small>{steps.length} 条记录</small>}<Icon name="chevron" size={13} />
            </summary>
            <div className="process-steps">{steps.map(step => <div className="message-body" key={step.id}>
              {step.toolLabels?.map((label, i) => <div key={i}>{label}</div>)}
              <MessageContent text={step.text} blocks={state.paper.blocks} onPreview={onPreview} />
            </div>)}</div>
          </details>;
        }
        const pending = pendingMessage?.id === m.id ? pendingMessage : null;
        const failed = pending?.delivery === "failed" || state.requests?.find(r => r.requestId === m.id)?.status === "failed";
        const waiting = index === lastUserIndex && !replyStarted && (sending || state.busy || pending?.delivery === "accepted");
        const selectable = m.role === "assistant" ? m.complete : !pending || state.messages.some(item => item.id === m.id);
        const content = <div className="message-body" data-chat-source={selectable ? m.id : undefined}>{m.role === "assistant" ? <MessageContent text={m.text} blocks={state.paper.blocks} onPreview={onPreview} /> : m.text}</div>;
        return <div className="message-row" key={m.id}>
          <article className={`chat-message ${m.role}`} aria-label={m.role === "user" ? "我的问题" : "Agent 回答"}>
            {m.role === "assistant" && <div className="answer-byline"><img alt="" src={`/assets/nota-agent-${m.provider || conversation.provider}.png`} />{providerNames[m.provider || conversation.provider]}</div>}
            {m.role === "user" && <QuoteChips anchors={messageAnchors(m)} onLocate={onLocate} />}
            {m.excerpts && <ChatQuoteChips excerpts={m.excerpts} onLocate={e => locateExcerpt(messages.current, e)} />}
            {content}
            {m.comments?.length ? <section className="message-comments" aria-label="消息评论">
              {m.comments.map(comment => <div key={comment.id}><button type="button" title="定位评论选文" onClick={() => locateExcerpt(messages.current, comment.excerpt)}>
                <Icon name="note" size={13} /><span>{comment.excerpt.text}</span>
              </button><p>{comment.body}</p></div>)}
            </section> : null}
            {m.role === "assistant" && m.complete && <div className="answer-actions">
              <button title={copied === m.id ? "已复制" : "复制回答"} aria-label={copied === m.id ? "已复制回答" : "复制回答"}
                onClick={() => void copyAnswer(m.id, m.text)}><Icon name={copied === m.id ? "check" : "copy"} size={15} /></button>
            </div>}
          </article>
          {m.role === "user" && (failed || waiting) && <div className={`message-delivery ${failed ? "failed" : ""}`} role="status">
            {failed ? <><span title={pending?.failure}>发送失败</span><button disabled={locked} onClick={() => restoreFailedMessage(m)}>重新编辑</button></> : <><i className="status-dot" />{pending?.delivery === "sending" || state.connection === "connecting" ? "发送中…" : state.activity?.label || "正在思考…"}</>}
          </div>}
          </div>;
      })}
      {state.busy && answerStarted && state.activity && !state.approvals?.length && <div className="message-delivery" role="status">{state.activity.label}</div>}
      {state.approvals?.map(a => <section className="agent-approval" key={a.id} aria-label="操作授权">
        <strong>允许这次操作？</strong><pre>{a.operation}</pre>{a.reason && <p>{a.reason}</p>}
        <div><button onClick={() => void command("approvals", { ...scope, id: a.id, allowed: false }).catch(fail)}>拒绝</button><button onClick={() => void command("approvals", { ...scope, id: a.id, allowed: true }).catch(fail)}>允许一次</button></div>
      </section>)}
    </div>
    <ChatSelection log={messages} paperId={scope.paperId} conversationId={scope.conversationId} onAdd={e => {
      if (!excerpts.some(x => excerptKey(x) === excerptKey(e))) editQuestion(question, [...excerpts, e]);
      textarea.current?.focus({ preventScroll: true });
    }} />
    {showLatest && <div className="latest-messages"><button aria-label="回到最新消息" onClick={() => { nearBottom.current = true; messages.current?.scrollTo({ top: messages.current.scrollHeight }); setShowLatest(false); }}><Icon name="down" size={14} />最新消息</button></div>}
    {error && <div className="agent-error" role="alert"><span>{error}</span><button aria-label="关闭对话提示" onClick={() => setError("")}><Icon name="close" size={14} /></button></div>}
    <form className="agent-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      <QuoteChips anchors={anchors} onLocate={onLocate} onRemove={onRemove} />
      <ChatQuoteChips excerpts={excerpts} onLocate={e => locateExcerpt(messages.current, e)}
        onRemove={e => editQuestion(question, excerpts.filter(x => excerptKey(x) !== excerptKey(e)))} />
      <textarea ref={textarea} value={question} maxLength={6000} onChange={e => editQuestion(e.target.value)} onBlur={flushDraft}
        placeholder={anchors.length ? `针对${subject}提问…` : `问 ${providerName}…`} aria-label="向 Agent 提问"
        onKeyDown={e => {
          // Enter used to confirm an IME candidate must never send the draft.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          if (!e.repeat) void send();
        }} />
      <div className="composer-actions">
        <ModelPicker state={state} onState={onState} onSettings={onSettings} />
        {state.busy ? <button className="send-button" type="button" title="停止回答" aria-label="停止回答" onClick={() => void run("stop")}><Icon name="stop" size={15} /></button> : <button className="send-button" title="Enter 发送，Shift+Enter 换行" aria-label="发送问题" disabled={!question.trim() || locked}><Icon name="arrow" size={18} /></button>}
      </div>
    </form>
  </aside>;
}
