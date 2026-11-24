export interface SourceToken {
  start: number;
  end: number;
  raw: string;
  tex?: string;
  display?: boolean;
}

// Offsets always refer to untouched OCR/translation text, never KaTeX's DOM.
export function mathTokens(source: string, formula = false, byline = false): SourceToken[] {
  const tokens: SourceToken[] = [];
  const escaped = (i: number) => {
    let n = 0;
    while (i > 0 && source[--i] === "\\") n++;
    return n % 2 === 1;
  };
  let cursor = 0;
  for (let i = 0; i < source.length; i++) {
    if (escaped(i)) continue;
    if (byline && source.startsWith("^{", i)) {
      const marker = source.slice(i).match(/^\^\{(?:[0-9*,†‡\s]|\\dagger|\\ddagger)+\}/)?.[0];
      if (marker) {
        if (i > cursor) tokens.push({ start: cursor, end: i, raw: source.slice(cursor, i) });
        cursor = i + marker.length;
        tokens.push({ start: i, end: cursor, raw: marker, tex: "{}" + marker });
        i = cursor - 1;
        continue;
      }
    }
    const open = source.startsWith("$$", i)
      ? "$$"
      : source.startsWith("\\[", i)
        ? "\\["
        : source.startsWith("\\(", i)
          ? "\\("
          : source[i] === "$"
            ? "$"
            : null;
    if (!open) continue;
    const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
    let end = i + open.length;
    while ((end = source.indexOf(close, end)) !== -1 && escaped(end))
      end += close.length;
    if (end === -1) continue;
    if (i > cursor)
      tokens.push({ start: cursor, end: i, raw: source.slice(cursor, i) });
    const stop = end + close.length;
    tokens.push({
      start: i,
      end: stop,
      raw: source.slice(i, stop),
      tex: source.slice(i + open.length, end),
      display: formula || open === "$$" || open === "\\[",
    });
    i = stop - 1;
    cursor = stop;
  }
  if (cursor < source.length)
    tokens.push({
      start: cursor,
      end: source.length,
      raw: source.slice(cursor),
    });
  if (formula && !tokens.some((t) => t.tex !== undefined) && source.trim())
    return [
      { start: 0, end: source.length, raw: source, tex: source, display: true },
    ];
  return tokens;
}

function sourceLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (node instanceof Element && node.hasAttribute("data-math-source"))
    return node.getAttribute("data-math-source")!.length;
  return Array.from(node.childNodes).reduce((n, c) => n + sourceLength(c), 0);
}

export function sourceOffsetAt(
  root: HTMLElement,
  node: Node,
  offset: number,
  edge: "start" | "end",
) {
  const element = node instanceof Element ? node : node.parentElement;
  const math = element?.closest<HTMLElement>("[data-math-source]");
  if (math && root.contains(math)) {
    // Selecting any part of a typeset formula selects the whole source expression.
    return Number(math.dataset[edge === "start" ? "mathStart" : "mathEnd"]);
  }
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(node, offset);
  return sourceLength(prefix.cloneContents());
}
