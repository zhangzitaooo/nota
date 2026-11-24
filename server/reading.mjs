export function validateReadingPosition(value, paper, translation) {
  if (value.paperId !== paper.id || value.documentVersion !== paper.version)
    throw Error("阅读位置的文档版本已变化");
  const b = paper.blocks.find((b) => b.id === value.blockId);
  if (
    !b ||
    !Number.isInteger(value.sourceOffset) ||
    value.sourceOffset < 0 ||
    value.sourceOffset > b.text.length
  )
    throw Error("阅读位置不在原文范围内");
  if (
    !["en", "zh", "bilingual"].includes(value.mode) ||
    !Number.isFinite(value.progress) ||
    value.progress < 0 ||
    value.progress > 1 ||
    !Number.isFinite(value.viewportOffset) ||
    Math.abs(value.viewportOffset) > 10000 ||
    (value.atTop !== undefined && typeof value.atTop !== "boolean")
  )
    throw Error("阅读位置无效");
  const segment =
    value.segmentId &&
    translation?.segments.find(
      (s) => s.id === value.segmentId && s.blockId === b.id,
    );
  if (value.segmentId && !segment) throw Error("阅读句段不存在");
  return {
    paperId: paper.id,
    documentVersion: paper.version,
    blockId: b.id,
    page: b.page,
    sourceOffset: value.sourceOffset,
    segmentId: segment?.id,
    progress: value.progress,
    viewportOffset: value.viewportOffset,
    mode: value.mode,
    atTop: !!value.atTop,
  };
}
