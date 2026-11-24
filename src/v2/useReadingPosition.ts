import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { ReadingMode, ReadingPosition, Snapshot } from "./types";

declare global {
  interface Window {
    persistReadingPosition?: () => Promise<void>;
  }
}

export function capturePosition(
  reader: HTMLElement,
  state: Snapshot,
  mode: ReadingMode,
): ReadingPosition | null {
  const line = reader.getBoundingClientRect().top + 92;
  const blocks = Array.from(
    reader.querySelectorAll<HTMLElement>("[data-block]"),
  );
  const block =
    blocks.find((b) => b.getBoundingClientRect().bottom > line) ||
    blocks[blocks.length - 1];
  if (!block) return null;
  const source = state.paper.blocks.find((b) => b.id === block.dataset.block)!;
  const spans = Array.from(
    block.querySelectorAll<HTMLElement>(".selectable"),
  ).filter(
    (s) => s.getClientRects().length && s.getBoundingClientRect().height > 0,
  );
  const span =
    spans.find((s) => s.getBoundingClientRect().bottom > line) ||
    spans[spans.length - 1];
  const rect = (span || block).getBoundingClientRect();
  const segment = state.translation?.segments.find(
    (s) => s.id === span?.dataset.segment,
  );
  return {
    paperId: state.paper.id,
    documentVersion: state.paper.version,
    blockId: source.id,
    page: source.page,
    sourceOffset: segment?.start ?? Number(span?.dataset.start || 0),
    segmentId: segment?.id,
    progress: Math.max(
      0,
      Math.min(1, (line - rect.top) / Math.max(1, rect.height)),
    ),
    viewportOffset: Math.max(92, rect.top - reader.getBoundingClientRect().top),
    mode,
    atTop: reader.scrollTop < 4,
  };
}

export function restorePosition(
  reader: HTMLElement,
  position: ReadingPosition,
) {
  if (position.atTop) {
    reader.scrollTop = 0;
    return;
  }
  const block = Array.from(
    reader.querySelectorAll<HTMLElement>("[data-block]"),
  ).find((b) => b.dataset.block === position.blockId);
  if (!block) return;
  const spans = Array.from(
    block.querySelectorAll<HTMLElement>(".selectable"),
  ).filter(
    (s) => s.getClientRects().length && s.getBoundingClientRect().height > 0,
  );
  const candidates = spans.filter((s) =>
    position.segmentId
      ? s.dataset.segment === position.segmentId
      : Number(s.dataset.start || 0) <= position.sourceOffset,
  );
  const span =
    candidates.find(
      (s) => s.dataset.lang === (position.mode === "en" ? "en" : "zh"),
    ) || candidates[0];
  const rect = (span || block).getBoundingClientRect();
  reader.scrollTop +=
    rect.top +
    position.progress * rect.height -
    reader.getBoundingClientRect().top -
    Math.min(position.viewportOffset, reader.clientHeight - 80);
}

export function useReadingPosition(
  reader: RefObject<HTMLElement>,
  state: Snapshot | null,
  onError: (e: Error) => void,
  active = true,
) {
  const [mode, setMode] = useState<ReadingMode>("zh");
  const latest = useRef({ state, mode, onError });
  latest.current = { state, mode, onError };
  const current = useRef<ReadingPosition | null>(null);
  const initialized = useRef("");
  const wasActive = useRef(active);
  const restoring = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef(0);
  const restoreFrame = useRef(0);
  const layoutFrame = useRef(0);
  const clientId = useRef(crypto.randomUUID());
  const sequence = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const capture = useCallback(() => {
    const { state, mode } = latest.current;
    if (state && reader.current?.clientHeight && !restoring.current) {
      current.current = capturePosition(reader.current, state, mode);
    }
    return current.current;
  }, [reader]);
  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const position = current.current;
    if (!position) return;
    const payload = {
      position,
      clientId: clientId.current,
      sequence: ++sequence.current,
    };
    const save = async () => {
      const res = await fetch("/api/reading-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) throw Error("阅读位置未保存，请检查本机服务连接");
    };
    pending.current = pending.current.catch(() => {}).then(save);
    await pending.current;
  }, []);
  const saveSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => void persist().catch(latest.current.onError),
      250,
    );
  }, [persist]);
  const restore = useCallback(() => {
    if (!current.current || !reader.current?.clientHeight) return;
    restoring.current = true;
    cancelAnimationFrame(restoreFrame.current);
    restorePosition(reader.current, current.current);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = requestAnimationFrame(() => {
        restoring.current = false;
      });
    });
  }, [reader]);
  const onScroll = useCallback(() => {
    if (restoring.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      capture();
      saveSoon();
    });
  }, [capture, saveSoon]);
  const changeMode = useCallback(
    (next: ReadingMode) => {
      if (next === latest.current.mode) return;
      capture();
      if (current.current) current.current = { ...current.current, mode: next };
      restoring.current = true;
      setMode(next);
      saveSoon();
    },
    [capture, saveSoon],
  );
  const preserveLayout = useCallback((update: () => void) => {
    capture();
    // Layout-generated scroll events must not replace the source anchor with
    // whatever happens to move underneath the viewport during reflow.
    restoring.current = true;
    update();
    cancelAnimationFrame(layoutFrame.current);
    layoutFrame.current = requestAnimationFrame(() => { restore(); saveSoon(); });
  }, [capture, restore, saveSoon]);
  const goTo = useCallback(
    (blockId: string, segmentId?: string, sourceOffset = 0) => {
      const paper = latest.current.state?.paper;
      const block = paper?.blocks.find((b) => b.id === blockId);
      if (!paper || !block) return;
      current.current = {
        paperId: paper.id,
        documentVersion: paper.version,
        blockId,
        page: block.page,
        segmentId,
        sourceOffset,
        progress: 0,
        viewportOffset: 110,
        mode: latest.current.mode,
      };
      restore();
      saveSoon();
    },
    [restore, saveSoon],
  );
  const flush = useCallback(async () => {
    // Only finish a pending scroll. A background window must not recapture and
    // overwrite the position saved by another window when it loses visibility.
    const pendingScroll = !!frame.current;
    if (pendingScroll) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      capture();
    }
    if (pendingScroll || timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      await persist();
    } else {
      await pending.current;
    }
  }, [capture, persist]);

  useLayoutEffect(() => {
    if (!state?.paper.blocks.length || !reader.current) return;
    const key = state.paper.id + ":" + state.paper.version;
    if (initialized.current !== key || (active && !wasActive.current)) {
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
      initialized.current = key;
      const saved = state.readingPosition;
      const valid =
        saved?.documentVersion === state.paper.version &&
        state.paper.blocks.some((b) => b.id === saved.blockId);
      current.current = valid
        ? saved!
        : {
            paperId: state.paper.id,
            documentVersion: state.paper.version,
            blockId: state.paper.blocks[0].id,
            page: state.paper.pages[0],
            sourceOffset: 0,
            progress: 0,
            viewportOffset: 92,
            mode: "zh",
            atTop: true,
          };
      setMode(current.current.mode);
      if (active) saveSoon();
    }
    wasActive.current = active;
    if (active) restore();
  }, [state?.paper.id, state?.paper.version, mode, active, restore, saveSoon]);

  useEffect(() => {
    const el = reader.current;
    if (!el || !state?.paper.blocks.length) return;
    // Images have reserved aspect ratios; font, width and translation reflow still need anchoring.
    const observer = new ResizeObserver(() => restore());
    const documentEl = el.querySelector(".document");
    observer.observe(el);
    if (documentEl) observer.observe(documentEl);
    const loaded = () => restore();
    el.addEventListener("load", loaded, true);
    document.fonts.addEventListener("loadingdone", loaded);
    return () => {
      observer.disconnect();
      el.removeEventListener("load", loaded, true);
      document.fonts.removeEventListener("loadingdone", loaded);
    };
  }, [state?.paper.id, restore]);

  useEffect(() => {
    window.persistReadingPosition = flush;
    const hide = () => {
      void flush().catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(restoreFrame.current);
      cancelAnimationFrame(layoutFrame.current);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      delete window.persistReadingPosition;
    };
  }, [flush]);
  return { mode, changeMode, goTo, onScroll, flush, capture, preserveLayout };
}
