import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { command } from "./api";
import { Icon } from "./Icon";
import type { ChatExcerpt } from "./types";

export const excerptKey = (e: ChatExcerpt) => JSON.stringify([e.messageId, e.start, e.end]);

export function locateExcerpt(root: HTMLElement | null, excerpt: ChatExcerpt) {
  const body = root?.querySelector<HTMLElement>(`[data-chat-source="${CSS.escape(excerpt.messageId)}"]`);
  if (!body) return;
  const nodes = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0, started = false;
  for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
    const next = offset + (node.textContent?.length || 0);
    if (!started && excerpt.start < next) {
      range.setStart(node, excerpt.start - offset);
      started = true;
    }
    if (started && excerpt.end <= next) {
      range.setEnd(node, excerpt.end - offset);
      range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    offset = next;
  }
  body.scrollIntoView({ block: "center" });
}

export function ChatQuoteChips({ excerpts, onLocate, onRemove }: {
  excerpts: ChatExcerpt[]; onLocate: (e: ChatExcerpt) => void; onRemove?: (e: ChatExcerpt) => void;
}) {
  if (!excerpts.length) return null;
  return <div className="quote-chips" role="group" aria-label="引用对话">
    {excerpts.map((e, i) => <span key={excerptKey(e)} className="quote-chip">
      <button type="button" className="quote-jump" title={e.text} aria-label={`定位对话引用 ${i + 1}`} onClick={() => onLocate(e)}>
        <Icon name="chat" size={13} /><span>{e.text}</span>
      </button>
      {onRemove && <button type="button" className="quote-remove" title="移除引用" aria-label={`移除对话引用 ${i + 1}`} onClick={() => onRemove(e)}><Icon name="close" size={12} /></button>}
    </span>)}
  </div>;
}

const saveShortcut = /Mac/i.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";

type Target = { excerpt: ChatExcerpt; range: Range };
export function ChatSelection({ log, paperId, conversationId, onAdd }: {
  log: RefObject<HTMLDivElement>; paperId: string; conversationId: string; onAdd: (excerpt: ChatExcerpt) => void;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [commentId, setCommentId] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const drafts = useRef(new Map<string, { id: string; body: string }>());
  const submitting = useRef(false);

  function close(returnFocus = false) {
    if (returnFocus && target) {
      const node = log.current?.querySelector<HTMLElement>(`[data-chat-source="${CSS.escape(target.excerpt.messageId)}"]`);
      node?.setAttribute("tabindex", "-1");
      node?.focus({ preventScroll: true });
    }
    setTarget(null);
    setCommentId("");
  }

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = field.scrollHeight + "px";
  }, [body, commentId]);

  useLayoutEffect(() => {
    const area = log.current, card = popup.current;
    if (!target || !area || !card) return;
    const position = () => {
      const rect = target.range.getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      const minX = Math.max(8, bounds.left + 8), maxX = Math.min(innerWidth - 8, bounds.right - 8);
      const minY = Math.max(8, bounds.top + 4), maxY = Math.min(innerHeight - 8, bounds.bottom - 4);
      if (rect.bottom < minY || rect.top > maxY || !target.range.commonAncestorContainer.isConnected) {
        if (!submitting.current) { setTarget(null); setCommentId(""); }
        return;
      }
      card.style.maxWidth = Math.max(1, maxX - minX) + "px";
      card.style.maxHeight = Math.max(1, maxY - minY) + "px";
      const { width, height } = card.getBoundingClientRect();
      const below = rect.bottom + 6, above = rect.top - 6 - height;
      const preferred = above >= minY ? above : below;
      const left = commentId ? rect.left + (rect.width - width) / 2 : rect.left;
      card.style.left = Math.max(minX, Math.min(left, maxX - width)) + "px";
      card.style.top = Math.max(minY, Math.min(preferred, maxY - height)) + "px";
    };
    position();
    if (commentId && typeof Highlight !== "undefined" && CSS.highlights) {
      CSS.highlights.set("nota-comment-source", new Highlight(target.range));
    }
    const observer = new ResizeObserver(position);
    observer.observe(card); observer.observe(area);
    area.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      CSS.highlights?.delete("nota-comment-source");
      observer.disconnect(); area.removeEventListener("scroll", position); window.removeEventListener("resize", position);
    };
  }, [target, commentId, log]);

  useEffect(() => {
    const area = log.current;
    if (!area) return;
    const select = () => {
      if (commentId) return;
      const sel = window.getSelection();
      if (!sel?.rangeCount || sel.isCollapsed) { setTarget(null); return; }
      const range = sel.getRangeAt(0);
      const start = range.startContainer;
      const el = start instanceof Element ? start : start.parentElement;
      const source = el?.closest<HTMLElement>("[data-chat-source]");
      const text = sel.toString();
      if (!source || !area.contains(source) || !source.contains(range.endContainer) || !text.trim()) {
        setTarget(null); return;
      }
      const before = document.createRange();
      before.selectNodeContents(source);
      before.setEnd(start, range.startOffset);
      const offset = before.toString().length;
      setTarget({ excerpt: { messageId: source.dataset.chatSource!, text, start: offset, end: offset + range.toString().length }, range: range.cloneRange() });
    };
    const pointer = (e: PointerEvent) => {
      if (!submitting.current && !popup.current?.contains(e.target as Node)) {
        setTarget(null); setCommentId("");
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !submitting.current && !commentId) setTarget(null);
      else if (e.shiftKey && area.contains(e.target as Node)) select();
    };
    area.addEventListener("pointerup", select);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keyup", key);
    return () => {
      area.removeEventListener("pointerup", select);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keyup", key);
    };
  }, [log, commentId, saving]);
  if (!target) return null;
  const { excerpt } = target;
  const key = excerptKey(excerpt);
  async function save() {
    if (!body.trim() || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError("");
    try {
      await command("conversations/comment", { paperId, conversationId, id: commentId, excerpt, body });
      drafts.current.delete(key); close(true);
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <div ref={popup} className={commentId ? "chat-comment-editor" : "selection-toolbar chat-selection-actions"}
    onKeyDown={e => {
      if (commentId && e.key === "Escape" && !e.nativeEvent.isComposing && e.keyCode !== 229 && !submitting.current) {
        e.stopPropagation(); e.preventDefault(); close(true);
      }
    }} role={commentId ? "dialog" : "toolbar"} aria-label={commentId ? "写评论" : "对话选区操作"}>
    {commentId ? <form aria-busy={saving} onSubmit={e => { e.preventDefault(); void save(); }}>
      <textarea ref={input} aria-label="评论内容" placeholder="添加评论…" autoFocus rows={1} maxLength={12000}
        value={body} readOnly={saving} onChange={e => {
          const text = e.target.value; setBody(text);
          if (text) drafts.current.set(key, { id: commentId, body: text });
          else drafts.current.delete(key);
        }} onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
        }} />
      <button type="submit" className="comment-save" title={`保存评论（${saveShortcut}）`}
        aria-label="保存评论" disabled={saving || !body.trim()}><Icon name="arrow" size={14} /></button>
      {error && <div className="comment-error" role="alert">{error}</div>}
    </form> : <>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => {
        window.getSelection()?.removeAllRanges(); setTarget(null); onAdd(excerpt);
      }}><Icon name="chat" size={14} />添加到对话</button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => {
        const draft = drafts.current.get(key);
        setCommentId(draft?.id || crypto.randomUUID()); setBody(draft?.body || ""); setError("");
      }}><Icon name="note" size={14} />评论</button>
    </>}
  </div>;
}
