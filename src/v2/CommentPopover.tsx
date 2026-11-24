import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { Icon } from "./Icon";

export function CommentPopover({ reader, target, value, saving, error, onChange, onSave, onClose }: {
  reader: RefObject<HTMLElement>; target: Range; value: string; saving: boolean; error: string;
  onChange: (value: string) => void; onSave: () => void; onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!field.current) return;
    field.current.style.height = "0px";
    field.current.style.height = field.current.scrollHeight + "px";
  }, [value]);

  useLayoutEffect(() => {
    const card = popup.current!, area = reader.current!;
    function position() {
      const rect = target.getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      const top = bounds.top + (area.querySelector(".reading-toolbar")?.clientHeight || 0) + 6;
      const bottom = Math.min(innerHeight, bounds.bottom) - 8;
      const width = Math.min(280, bounds.width - 20);
      card.style.width = width + "px";
      card.style.left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - width - 8)) + "px";
      const above = rect.top - card.offsetHeight - 6;
      card.style.top = Math.max(top, Math.min(above >= top ? above : rect.bottom + 6, bottom - card.offsetHeight)) + "px";
      card.style.visibility = rect.bottom < top || rect.top > bottom ? "hidden" : "visible";
    }
    position();
    field.current?.focus({ preventScroll: true });
    if (typeof Highlight !== "undefined") CSS.highlights.set("nota-reading-draft", new Highlight(target));
    const resize = new ResizeObserver(position);
    resize.observe(card); resize.observe(area);
    area.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      CSS.highlights?.delete("nota-reading-draft");
      resize.disconnect(); area.removeEventListener("scroll", position); window.removeEventListener("resize", position);
    };
  }, [reader, target]);

  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!saving && !popup.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose, saving]);

  return createPortal(<div ref={popup} className="chat-comment-editor reading-comment-editor" role="dialog" aria-label="写批注">
    <form aria-busy={saving} onSubmit={e => { e.preventDefault(); if (!saving && value.trim()) onSave(); }}>
      <textarea ref={field} aria-label="批注内容" placeholder="写下批注…" rows={1} maxLength={12000}
        value={value} readOnly={saving} onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
        }} />
      <button type="submit" className="comment-save" aria-label="保存批注" title="保存批注" disabled={saving || !value.trim()}><Icon name="arrow" size={14} /></button>
      {error && <div className="comment-error" role="alert">{error}</div>}
    </form>
  </div>, document.body);
}
