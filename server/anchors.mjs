import { validateTranslationSelection } from "./translation.mjs";

// Anchors always address immutable source text. Models never supply offsets.
export function validateAnchor(body, paper, translation) {
  const anchor = validatePart(body, paper, translation);
  if (body.continuation === undefined) return anchor;
  if (!Array.isArray(body.continuation)) throw Error("选区格式无效");
  return { ...anchor, continuation: body.continuation.map(part => validatePart(part, paper, translation)) };
}

function validatePart(body, paper, translation) {
  if (body.paperId !== paper.id || body.documentVersion !== paper.version) {
    throw Error("论文已切换，请重新选择原文");
  }
  const block = paper.blocks.find((b) => b.id === body.blockId);
  if (!block) throw Error("选区所在段落不存在");
  const { startOffset: start, endOffset: end, selectedText: text } = body;
  const image =
    !block.text && block.asset && text === "[图表]" && start === 0 && end === 0;
  if (
    !image &&
    !(
      typeof text === "string" &&
      text.length &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= block.text.length &&
      block.text.slice(start, end) === text
    )
  ) {
    throw Error("选区与原文位置不匹配，请重新划选");
  }
  if (body.language && !["zh", "en"].includes(body.language))
    throw Error("选区语言无效");
  return {
    paperId: paper.id,
    documentVersion: paper.version,
    blockId: block.id,
    page: block.page,
    selectedText: text,
    startOffset: start,
    endOffset: end,
    language: body.language || "en",
    ...validateTranslationSelection(body, translation, block),
  };
}
