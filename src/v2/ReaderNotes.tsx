import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { command } from "./api";
import { Icon } from "./Icon";
import { RichText } from "./Reader";
import { quoteText, type Annotation } from "./types";

export function MarginCard({ note, paperId, active, onSelect, onDismiss, onPreview }: {
  note: Annotation; paperId: string; active: boolean; onSelect: () => void; onDismiss: () => void; onPreview: () => void;
}) {
  const date = new Date(note.savedAt);
  const body = useRef<HTMLParagraphElement>(null);
  const card = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const attempt = useRef<{ id: string; body: string }>();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [overflows, setOverflows] = useState(false);
  const editing = replying && active;
  function openThread() {
    onSelect();
    setReplying(true);
  }
  useEffect(() => {
    if (!active) setReplying(false);
  }, [active]);
  useLayoutEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true });
  }, [editing]);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  }, [editing, draft]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || pending.current) return;
    pending.current = true;
    setSaving(true); setError("");
    if (attempt.current?.body !== text) attempt.current = { id: crypto.randomUUID(), body: text };
    try {
      await command("annotations/reply", { ...attempt.current, paperId, annotationId: note.annotationId });
      setDraft("");
      attempt.current = undefined;
      input.current?.focus({ preventScroll: true });
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setSaving(false); }
  }
  useLayoutEffect(() => {
    if (active || !body.current) return;
    const el = body.current;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, note.body]);

  return <section ref={card} id={`reader-note-${note.annotationId}`} tabIndex={0} className="reader-margin-card" data-active={active}
    aria-label={note.body ? "批注" : "高亮"} onClick={e => {
      if ((e.target as Element).closest("button, form") || window.getSelection()?.type === "Range") return;
      openThread();
    }} onKeyDown={e => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (active && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const marker = card.current?.closest(".reader-annotated-row")?.querySelector<HTMLButtonElement>(".margin-note");
        const returnTarget = marker?.getClientRects().length ? marker : card.current;
        onDismiss();
        returnTarget?.focus({ preventScroll: true });
      } else if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault(); openThread();
      }
    }}>
    <div className="reader-note-meta">
      <strong>{note.author === "codex" ? "Codex" : "我"}</strong>
      <time dateTime={note.savedAt}>{date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</time>
      <button title={`查看原 PDF 第 ${note.page} 页`} aria-label={`查看原 PDF 第 ${note.page} 页`} onClick={onPreview}><Icon name="source" size={13} /></button>
    </div>
    <p ref={body} data-clamped={!active}><RichText text={note.body || quoteText(note)} /></p>
    {overflows && !active && <button className="note-more" aria-expanded={false} onClick={openThread}>展开全文</button>}
    {!!note.replies?.length && <ol className="note-replies" aria-label="批注回复">{note.replies.map(reply =>
      <li key={reply.id}>
        <div className="reader-note-meta"><strong>我</strong><time dateTime={reply.savedAt}>
          {new Date(reply.savedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </time></div>
        <p>{reply.body}</p>
      </li>)}</ol>}
    {editing && <form className="note-reply-form" aria-label="回复批注" aria-busy={saving} onSubmit={e => { e.preventDefault(); void sendReply(); }}>
      <textarea ref={input} rows={1} maxLength={12000} aria-label="回复内容" placeholder="回复…" readOnly={saving} value={draft}
        onChange={e => setDraft(e.target.value)} onKeyDown={e => {
          if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault(); void sendReply();
          }
        }} />
      <button type="submit" className="comment-save" aria-label="发送回复" title="发送回复（⌘ / Ctrl + Enter）" disabled={saving || !draft.trim()}><Icon name="arrow" size={14} /></button>
      {error && <small role="alert">{error}</small>}
    </form>}
  </section>;
}
