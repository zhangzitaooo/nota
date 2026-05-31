import { PaperBlock, Annotation, ChatThread } from './types';

/** 生成唯一 ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** 根据 blocks 和 annotations 渲染带标注的 HTML */
export function renderBlockHtml(
  block: PaperBlock,
  annotations: Annotation[]
): string {
  const text = block.zh || block.en;
  const blockAnnotations = block.zh
    ? annotations.filter((a) => a.blockId === block.id)
    : [];

  if (blockAnnotations.length === 0) {
    return escapeHtml(text);
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const ann of blockAnnotations) {
    boundaries.add(Math.max(0, Math.min(ann.start, text.length)));
    boundaries.add(Math.max(0, Math.min(ann.end, text.length)));
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const parts: string[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (start >= end) continue;

    const segment = escapeHtml(text.slice(start, end));
    const activeAnnotations = blockAnnotations.filter((ann) => ann.start < end && ann.end > start);
    const highlight = activeAnnotations.find((ann) => ann.type === 'highlight');
    const bold = activeAnnotations.find((ann) => ann.type === 'bold');

    parts.push(wrapAnnotatedSegment(segment, highlight, bold));
  }

  return parts.join('');
}

function wrapAnnotatedSegment(
  segment: string,
  highlight?: Annotation,
  bold?: Annotation
): string {
  let html = segment;

  if (bold) {
    html = `<strong class="annotation-bold" data-annotation-id="${bold.id}">${html}</strong>`;
  }

  if (highlight) {
    html = `<mark class="annotation-highlight" data-annotation-id="${highlight.id}">${html}</mark>`;
  }

  return html;
}

/** 判断选区是否在 block 内，返回在 zh 文本中的 start/end */
export function getSelectionInBlock(
  selection: Selection,
  blockElement: HTMLElement
): { start: number; end: number; text: string } | null {
  if (!selection.rangeCount) return null;

  const range = selection.getRangeAt(0);

  // 确保选区在 block 内
  if (!blockElement.contains(range.commonAncestorContainer)) return null;

  // 获取 block 的纯文本
  const fullText = blockElement.textContent || '';

  // 创建 range 覆盖 block 开头到选区开始
  const preRange = document.createRange();
  preRange.selectNodeContents(blockElement);
  preRange.setEnd(range.startContainer, range.startOffset);

  const start = preRange.toString().length;
  const selectedText = range.toString();
  const end = start + selectedText.length;

  if (!selectedText.trim()) return null;

  return { start, end, text: selectedText };
}

/** 创建新的 Annotation */
export function createAnnotation(
  blockId: string,
  type: 'highlight' | 'bold',
  start: number,
  end: number,
  selectedText: string
): Annotation {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    blockId,
    type,
    start,
    end,
    selectedText,
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建新的 ChatThread */
export function createChatThread(
  blockId: string,
  selectedText: string,
  context: {
    paperTitle: string;
    sectionPath: string[];
    zhBlock: string;
    enBlock: string;
  }
): ChatThread {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    blockId,
    selectedText,
    context,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
