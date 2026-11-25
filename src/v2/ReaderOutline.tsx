import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "./Icon";

type Section = { id: string; label: string; nested: boolean };

export function ReaderOutline({ sections, reader, collapsed, onToggle, onJump }: {
  sections: Section[];
  reader: RefObject<HTMLElement>;
  collapsed: boolean;
  onToggle: () => void;
  onJump: (id: string) => void;
}) {
  const [active, setActive] = useState("");
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = reader.current;
    if (!root) return;
    const headings = sections.map(s => document.getElementById("block-" + s.id));
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + 124;
      let low = 0, high = headings.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if ((headings[mid]?.getBoundingClientRect().top ?? Infinity) <= line) low = mid + 1;
        else high = mid;
      }
      setActive(sections[low - 1]?.id || "");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const doc = root.querySelector(".document");
    if (doc) observer.observe(doc);
    root.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); root.removeEventListener("scroll", schedule); };
  }, [reader, sections]);
  useEffect(() => {
    const container = nav.current;
    const item = container?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!item || !container?.clientHeight) return;
    const y = item.offsetTop;
    if (y < container.scrollTop || y + item.offsetHeight > container.scrollTop + container.clientHeight)
      container.scrollTop = y - container.clientHeight / 2;
  }, [active, collapsed]);
  return <aside className="reader-outline">
    <button type="button" className="outline-toggle" onClick={onToggle}
      aria-expanded={!collapsed} aria-controls="reader-sections"
      aria-label={collapsed ? "展开目录" : "收起目录"} title={collapsed ? "展开目录" : "收起目录"}>
      <Icon name="menu" size={15} />{!collapsed && "目录"}
    </button>
    <nav id="reader-sections" hidden={collapsed} aria-label="章节目录" ref={nav}>{sections.map(s =>
      <button type="button" key={s.id} className={s.nested ? "subsection" : undefined}
        aria-current={s.id === active ? "location" : undefined} onClick={() => onJump(s.id)}>{s.label}</button>
    )}</nav>
  </aside>;
}
