import { useMemo } from "react";
import { MathText } from "./MathText";
import { sourceOffsetAt } from "./math";
import { assetUrl } from "./api";
import { Icon } from "./Icon";
import type {
  Anchor,
  AnchorPart,
  Annotation,
  Block,
  Paper,
  ReadingMode,
  Segment,
  Translation,
} from "./types";

export function RichText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, i) =>
          part.startsWith("**") ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </>
  );
}

export function PaperBlock({
  block: b,
  className = "",
  paper,
  translation,
  mode,
  notes,
  onPreview,
  onReference,
  onNotes,
  activeNote,
}: {
  block: Block;
  className?: string;
  paper: Paper;
  translation: Translation | null;
  mode: ReadingMode;
  notes: Annotation[];
  onPreview: (b: Block) => void;
  onReference: (b: Block) => void;
  onNotes: (annotationId: string | null) => void;
  activeNote: string | null;
}) {
  const segments = useMemo(
    () => translation?.segments.filter((s) => s.blockId === b.id) || [],
    [translation, b.id],
  );
  function text(
    source: string,
    start: number,
    lang: "zh" | "en",
    seg?: Segment,
  ) {
    const ranges: [number, number, string][] = [];
    for (const n of notes) {
      if (lang === "zh") {
        if (
          n.language === "zh" && n.segmentId === seg?.id &&
          n.translationVersion === translation?.version &&
          source.slice(n.translationStart, n.translationEnd) ===
            n.translatedText
        )
          ranges.push([n.translationStart!, n.translationEnd!, n.annotationId]);
        else if (
          n.language === "en" &&
          seg &&
          n.startOffset < seg.end &&
          n.endOffset > seg.start &&
          b.text.slice(n.startOffset, n.endOffset) === n.selectedText
        )
          ranges.push([0, source.length, n.annotationId]);
      } else if (b.text.slice(n.startOffset, n.endOffset) === n.selectedText) {
        const a = Math.max(n.startOffset, start) - start,
          z = Math.min(n.endOffset, start + source.length) - start;
        if (z > a) ranges.push([a, z, n.annotationId]);
      }
    }
    return (
      <span
        className={`selectable ${lang}`}
        data-lang={lang}
        data-start={start}
        data-segment={seg?.id}
        data-source-text={source}
      >
        <MathText
          text={source}
          ranges={ranges}
          activeNote={activeNote}
          byline={className === "paper-byline"}
          formula={b.type === "Formula"}
          math={b.type !== "Code Block"}
        />
      </span>
    );
  }
  const noteCount = new Set(notes.map(n => n.annotationId)).size;
  const original = ["Table", "Code Block", "Formula"].includes(b.type);
  const content =
    original || !segments.length ? (
      <p className={original && b.type !== "Formula" ? "verbatim" : ""}>
        {text(b.text, 0, "en")}
      </p>
    ) : mode === "en" ? (
      <p>
        {segments.map((s, i) => (
          <span key={s.id}>
            {b.text.slice(i ? segments[i - 1].end : 0, s.start)}
            {text(s.source, s.start, "en", s)}
          </span>
        ))}
        {b.text.slice(segments[segments.length - 1].end)}
      </p>
    ) : mode === "zh" ? (
      <p>
        {segments.map((s) => (
          <span key={s.id}>
            {s.zh ? (
              text(s.zh, 0, "zh", s)
            ) : (
              <>
                {text(s.source, s.start, "en", s)}
                <small className="pending-label"> 待翻译</small>
              </>
            )}{" "}
          </span>
        ))}
      </p>
    ) : (
      <div className="parallel-text">
        {segments.map((s) => (
          <div className="sentence-pair" data-pair={s.id} key={s.id}>
            <p className="english-line">{text(s.source, s.start, "en", s)}</p>
            <p>
              {s.zh ? (
                text(s.zh, 0, "zh", s)
              ) : (
                <small className="pending-label">此句段待翻译</small>
              )}
            </p>
          </div>
        ))}
      </div>
    );
  return (
    <article
      className={`paper-block ${className} ${b.type.toLowerCase().split(" ").join("-")}`}
      id={`block-${b.id}`}
      data-block={b.id}
      data-page={b.page}
      onClick={(e) => {
        const mark = (e.target as Element).closest<HTMLElement>("[data-note-id]");
        if (mark?.dataset.noteId && window.getSelection()?.isCollapsed) onNotes(mark.dataset.noteId);
      }}
    >
      <div className="block-tools">
        <button
          title="查看 PDF 原页"
          aria-label={`查看 ${b.id} 原页`}
          onClick={() => onPreview(b)}
        >
          <Icon name="source" size={14} />
        </button>
        <button
          title="引用这一段"
          aria-label={`引用 ${b.id}`}
          onClick={() => onReference(b)}
        >
          <Icon name="chat" size={14} />
        </button>
      </div>
      {b.asset && (
        <figure>
          <button
            className="figure-button"
            onClick={() => onPreview(b)}
            aria-label={`查看第 ${b.page} 页图表`}
          >
            <img
              src={assetUrl(paper.id, b.asset)}
              alt={`原文第 ${b.page} 页图表`}
              loading="lazy"
              style={
                b.bbox
                  ? {
                      aspectRatio: `${Math.max(1, b.bbox[2] - b.bbox[0])} / ${Math.max(1, b.bbox[3] - b.bbox[1])}`,
                    }
                  : undefined
              }
            />
          </button>
        </figure>
      )}
      {b.type === "Title" ? <div role="heading" aria-level={className === "cover-title" ? 1 : 2} className="block-heading">{content}</div> : b.type === "Table" ? (
        <details className="table-ocr">
          <summary>查看表格识别文字</summary>
          {content}
        </details>
      ) : (
        b.text && content
      )}
      {notes.length > 0 && (
        <button
          className="margin-note"
          aria-expanded={notes.some(n => n.annotationId === activeNote)}
          onClick={() => onNotes(notes.some(n => n.annotationId === activeNote) ? null : notes[0].annotationId)}
          title="查看此段批注"
          aria-label={`查看第 ${b.page} 页此段的 ${noteCount} 条批注`}
        >
          <Icon name="annotatedPage" size={15} />
          <span>{noteCount}</span>
        </button>
      )}
    </article>
  );
}

export function anchorFromSelection(
  paper: Paper,
  translation: Translation | null,
): { anchor: Anchor; x: number; y: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const elementOf = (node: Node) => node instanceof Element ? node : node.parentElement;
  const start = elementOf(range.startContainer), end = elementOf(range.endContainer);
  const doc = start?.closest(".document");
  if (!doc || end?.closest(".document") !== doc ||
      !start?.closest("[data-block]") || !end?.closest("[data-block]") ||
      start.closest("button, .block-tools") || end.closest("button, .block-tools")) return null;
  const common = elementOf(range.commonAncestorContainer);
  if (!common) return null;
  const sameSpan = common.closest<HTMLElement>(".selectable");
  const spans = sameSpan ? [sameSpan] : common.querySelectorAll<HTMLElement>(".selectable");
  const parts: AnchorPart[] = [];
  for (const span of spans) {
    if (!range.intersectsNode(span) || !span.getClientRects().length) continue;
    const b = paper.blocks.find(block => block.id === span.closest<HTMLElement>("[data-block]")?.dataset.block);
    if (!b) return null;
    const source = span.dataset.sourceText || "";
    const from = span.contains(range.startContainer) ? sourceOffsetAt(span, range.startContainer, range.startOffset, "start") : 0;
    const to = span.contains(range.endContainer) ? sourceOffsetAt(span, range.endContainer, range.endOffset, "end") : source.length;
    const raw = source.slice(from, to);
    const text = raw.trim();
    if (!text) continue;
    const offset = from + raw.length - raw.trimStart().length;
    const startOffset = Number(span.dataset.start || 0) + offset;
    let part: AnchorPart = {
      paperId: paper.id, documentVersion: paper.version, blockId: b.id, page: b.page,
      language: "en", selectedText: text, startOffset, endOffset: startOffset + text.length,
    };
    if (span.dataset.lang === "zh") {
      const seg = translation?.segments.find(s => s.id === span.dataset.segment);
      if (!translation || !seg?.zh || seg.zh.slice(offset, offset + text.length) !== text) return null;
      part = { ...part, language: "zh", selectedText: seg.source, startOffset: seg.start, endOffset: seg.end,
        segmentId: seg.id, translationVersion: translation.version, translatedText: text,
        translationStart: offset, translationEnd: offset + text.length };
    } else if (b.text.slice(part.startOffset, part.endOffset) !== text) return null;
    const prev = parts[parts.length - 1];
    if (prev?.language === "en" && part.language === "en" && prev.blockId === b.id && prev.endOffset <= part.startOffset) {
      prev.endOffset = part.endOffset;
      prev.selectedText = b.text.slice(prev.startOffset, prev.endOffset);
    } else parts.push(part);
  }
  if (!parts.length) return null;
  const [first, ...continuation] = parts;
  const anchor = continuation.length ? { ...first, continuation } : first;
  const rect = range.getBoundingClientRect();
  return {
    anchor,
    x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
    y: Math.max(64, rect.top - 48),
  };
}
