import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const key = "nota.reading.appearance";
const defaults = { size: 18, width: 720, spacing: 1.85 };
type Appearance = typeof defaults;
export function useReadingAppearance() {
  const [value, setValue] = useState<Appearance>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved) return {
        size: [16, 17, 18, 19, 20, 21, 22].includes(saved.size) ? saved.size : defaults.size,
        width: [600, 720, 840].includes(saved.width) ? saved.width : defaults.width,
        spacing: [1.65, 1.85, 2.05].includes(saved.spacing) ? saved.spacing : defaults.spacing,
      };
    } catch { /* Use readable defaults if storage is unavailable. */ }
    return defaults;
  });
  function update(next: Appearance) {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session preferences still work. */ }
  }
  return { value, update };
}

export function ReadingAppearance({ value, onChange }: { value: Appearance; onChange: (v: Appearance) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside);
    root.current?.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); root.current?.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="reading-appearance" ref={root}>
    <button ref={trigger} className="appearance-trigger" aria-label="阅读设置" title="阅读设置" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}>Aa</button>
    {open && <div className="appearance-popover" role="dialog" aria-label="阅读设置">
      <header><strong>阅读设置</strong><button aria-label="关闭阅读设置" onClick={() => { setOpen(false); trigger.current?.focus(); }}><Icon name="close" size={16} /></button></header>
      <div className="appearance-row"><span>字号</span><div className="font-stepper"><button aria-label="缩小字号" disabled={value.size <= 16} onClick={() => onChange({ ...value, size: value.size - 1 })}><Icon name="minus" size={16} /></button><output aria-live="polite">{value.size}</output><button aria-label="增大字号" disabled={value.size >= 22} onClick={() => onChange({ ...value, size: value.size + 1 })}><Icon name="plus" size={16} /></button></div></div>
      <fieldset className="appearance-row"><legend>行宽</legend><div className="appearance-options">{[[600, "窄"], [720, "适中"], [840, "宽"]].map(([width, label]) => <button key={width} aria-pressed={value.width === width} onClick={() => onChange({ ...value, width: Number(width) })}>{label}</button>)}</div></fieldset>
      <fieldset className="appearance-row"><legend>行距</legend><div className="appearance-options">{[[1.65, "紧凑"], [1.85, "适中"], [2.05, "宽松"]].map(([spacing, label]) => <button key={spacing} aria-pressed={value.spacing === spacing} onClick={() => onChange({ ...value, spacing: Number(spacing) })}>{label}</button>)}</div></fieldset>
      <button className="appearance-reset" onClick={() => onChange(defaults)}>恢复默认</button>
    </div>}
  </div>;
}
