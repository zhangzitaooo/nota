import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "./Icon";

type Section = { id: string; label: string; nested: boolean };

export function ReaderOutline({ sections, reader, onJump }: {
  sections: Section[];
  reader: RefObject<HTMLElement>;
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
  }, [active]);
  return <aside className="reader-outline">
    <h2><Icon name="menu" size={15} />目录</h2>
    <nav aria-label="章节目录" ref={nav}>{sections.map(s =>
      <button type="button" key={s.id} className={s.nested ? "subsection" : undefined}
        aria-current={s.id === active ? "location" : undefined} onClick={() => onJump(s.id)}>{s.label}</button>
    )}</nav>
  </aside>;
}
