import { useEffect, useRef, useState } from 'react';

const storageKey = 'nota.agent-panel.width';
const bounds = () => ({ min: Math.min(300, window.innerWidth - 24), max: Math.max(300, Math.min(900, window.innerWidth - (window.innerWidth > 850 ? 500 : 24))) });
const clamp = (value: number) => Math.min(bounds().max, Math.max(bounds().min, value));
const initialWidth = () => {
  try { const saved = Number(localStorage.getItem(storageKey)); if (Number.isFinite(saved) && saved > 0) return clamp(saved); } catch {}
  return window.innerWidth >= 1360 ? 420 : window.innerWidth <= 1050 ? 340 : 380;
};
export function usePanelWidth() {
  const [width, setWidth] = useState(initialWidth);
  useEffect(() => { const resize = () => setWidth(w => clamp(w)); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const persist = (value: number) => { try { localStorage.setItem(storageKey, String(clamp(value))); } catch {} };
  return { width, setWidth, persist };
}
export function PanelResizer({ width, onWidth, onEnd }: { width: number; onWidth: (n: number) => void; onEnd: (n: number) => void }) {
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const finish = () => { if (!drag.current) return; onEnd(drag.current.current); drag.current = null; setDragging(false); };
  return <div className={`panel-resizer ${dragging ? 'is-resizing' : ''}`} role="separator" aria-label="调整 Agent 侧栏宽度" aria-orientation="vertical" aria-valuemin={bounds().min} aria-valuemax={bounds().max} aria-valuenow={Math.round(width)} tabIndex={0}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width, current: width }; setDragging(true); }}
    onPointerMove={e => { if (!drag.current) return; const next = clamp(drag.current.width + drag.current.x - e.clientX); drag.current.current = next; onWidth(next); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => { const next = clamp(390); onWidth(next); onEnd(next); }}
    onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = clamp(e.key === 'Home' ? bounds().min : e.key === 'End' ? bounds().max : width + (e.key === 'ArrowLeft' ? 32 : -32)); onWidth(next); onEnd(next); }} />;
}
