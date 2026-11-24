import { useEffect, useRef } from "react";

const swing = (angles: number[]) => angles.map(angle => ({ transform: `rotate(${angle}deg)` }));
const tricks = [
  { rig: swing([0, -23, 20, -11, 5, 0]), duration: 2100 },
  { paper: ["none", "translateY(1px) scale(1.08,.90)", "translateY(-8px) rotate(-9deg)", "translateY(1px) scale(1.08,.91)", "translateY(-2px)", "none"], duration: 900 },
  { paper: ["none", "translateX(6px) rotate(18deg)", "translateX(6px) rotate(18deg)", "translateX(-2px) rotate(-6deg)", "none"], duration: 1350 },
  { paper: ["none", "translateY(-3px) rotateY(70deg)", "translateY(-4px) rotateY(180deg)", "translateY(-2px) rotateY(285deg)", "rotateY(360deg)"], duration: 1050 },
];

export function LibraryMascot() {
  const rig = useRef<HTMLSpanElement>(null);
  const paper = useRef<HTMLImageElement>(null);
  const active = useRef<Animation | null>(null);
  const next = useRef(0);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => active.current?.cancel();
    preference.addEventListener("change", stop);
    return () => {
      preference.removeEventListener("change", stop);
      stop();
    };
  }, []);

  function play(hover = false) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!hover) paper.current?.toggleAttribute("data-peeking");
      return;
    }
    if (hover && active.current?.playState === "running") return;
    const trick = hover ? { rig: swing([0, -8, 6, 0]), duration: 850 } : tricks[next.current];
    const element = trick.rig ? rig.current : paper.current;
    const frames = trick.rig ?? trick.paper?.map(transform => ({ transform }));
    if (!element || !frames) return;
    active.current?.cancel();
    active.current = element.animate(frames, { duration: trick.duration, easing: "ease-in-out" });
    if (!hover) next.current = (next.current + 1) % tricks.length;
  }

  return <button type="button" className="library-mascot" title="逗逗 Nota" aria-label="逗逗小纸人"
    onPointerEnter={event => { if (event.pointerType === "mouse") play(true); }} onClick={() => play()}>
    <span className="swing-idle" aria-hidden="true">
      <span className="swing-rig" ref={rig}>
        <span className="swing-seat" />
        <img ref={paper} src="/assets/nota-agent-builtin.png" alt="" width="36" height="36" draggable={false} />
      </span>
    </span>
  </button>;
}
