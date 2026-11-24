import { useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Modal({ title, label, className = "", busy = false, onClose, children }: {
  title: string; label?: string; className?: string; busy?: boolean;
  onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = dialog.current!;
    el.showModal();
    el.querySelector<HTMLElement>("[data-initial-focus]")?.focus({ preventScroll: true });
    return () => { el.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className={`nota-modal ${className}`} aria-label={label} aria-labelledby={label ? undefined : titleId}
    aria-busy={busy} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => {
      if (e.target !== dialog.current || busy) return;
      const r = dialog.current.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}>
    <header className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" aria-label={label === "导入论文" ? "关闭导入" : "关闭设置"} disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="modal-content">{children}</div>
  </dialog>;
}
