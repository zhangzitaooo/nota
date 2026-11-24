import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { SourceToken } from "./math";
import { mathTokens } from "./math";

export function MathText({
  text,
  ranges,
  activeNote,
  formula = false,
  math = true,
  byline = false,
}: {
  text: string;
  ranges: [number, number, string][];
  activeNote?: string | null;
  formula?: boolean;
  math?: boolean;
  byline?: boolean;
}) {
  const tokens = useMemo<SourceToken[]>(
    () =>
      math
        ? mathTokens(text, formula, byline)
        : [{ start: 0, end: text.length, raw: text }],
    [text, formula, math, byline],
  );
  return (
    <>
      {tokens.map((t) => {
        const overlapping = ranges.filter(([a, z]) => a < t.end && z > t.start);
        if (t.tex !== undefined)
          return (
            <Formula
              key={t.start}
              raw={t.raw}
              tex={t.tex}
              start={t.start}
              end={t.end}
              display={!!t.display}
              noteId={overlapping.find(r => r[2] === activeNote)?.[2] || overlapping[0]?.[2]}
              active={overlapping.some(r => r[2] === activeNote)}
            />
          );
        const points = Array.from(
          new Set([
            t.start,
            t.end,
            ...overlapping.flatMap(([a, z]) => [
              Math.max(a, t.start),
              Math.min(z, t.end),
            ]),
          ]),
        ).sort((a, b) => a - b);
        return points.slice(0, -1).map((a, i) => {
          const z = points[i + 1],
            piece = text.slice(a, z);
          const matches = overlapping.filter(([s, e]) => a < e && z > s);
          const active = matches.find(r => r[2] === activeNote);
          return matches.length ? (
            <mark key={a} data-note-id={(active || matches[0])[2]} data-active={!!active}>{piece}</mark>
          ) : (
            piece
          );
        });
      })}
    </>
  );
}

function Formula({
  raw,
  tex,
  start,
  end,
  display,
  noteId, active,
}: {
  raw: string;
  tex: string;
  start: number;
  end: number;
  display: boolean;
  noteId?: string; active: boolean;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        output: "htmlAndMathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 500,
        maxSize: 20,
      });
    } catch {
      return null;
    }
  }, [tex, display]);
  return (
    <span
      className={`math-source ${display ? "display-math" : "inline-math"} ${noteId ? "math-marked" : ""} ${html ? "" : "math-fallback"}`}
      data-note-id={noteId} data-active={active}
      data-math-source={raw}
      data-math-start={start}
      data-math-end={end}
      title={html ? raw : "此公式暂无法排版，保留原文"}
    >
      {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : raw}
    </span>
  );
}
