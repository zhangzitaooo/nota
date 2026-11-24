export interface Block {
  id: string;
  page: number;
  type: string;
  text: string;
  title: string;
  asset?: string;
  relatedAsset?: string;
  captionId?: string;
  bbox?: [number, number, number, number];
  pageSize?: { w: number; h: number };
}
export interface Paper {
  id: string;
  version: number;
  title: string;
  fileName?: string;
  parser?: string;
  pages: number[];
  sourcePages?: number;
  blocks: Block[];
}
export interface Segment {
  id: string;
  blockId: string;
  page: number;
  start: number;
  end: number;
  source: string;
  zh: string | null;
  kind: "original" | "translation";
}
export interface Translation {
  version: number;
  status: string;
  completed: number;
  total: number;
  error?: string;
  segments: Segment[];
}
export interface AnchorPart {
  paperId: string;
  documentVersion: number;
  blockId: string;
  page: number;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  language: "en" | "zh";
  segmentId?: string;
  translationVersion?: number;
  translationStart?: number;
  translationEnd?: number;
  translatedText?: string;
}
export interface Anchor extends AnchorPart {
  continuation?: AnchorPart[];
}
export function anchorKey(anchor: Anchor) {
  return JSON.stringify([anchor, ...(anchor.continuation || [])].map(p => [
    p.paperId, p.documentVersion, p.blockId, p.language, p.startOffset, p.endOffset,
    p.segmentId, p.translationVersion, p.translationStart, p.translationEnd,
  ]));
}
export function quoteText(anchor: Anchor) {
  let text = anchor.translatedText || anchor.selectedText;
  let previous = anchor;
  for (const part of anchor.continuation || []) {
    const separator = part.blockId !== previous.blockId || part.language !== previous.language ? "\n" : part.language === "zh" ? "" : " ";
    text += separator + (part.translatedText || part.selectedText);
    previous = part;
  }
  return text;
}
export interface Annotation extends Anchor {
  replies?: { id: string; author: "user"; body: string; savedAt: string }[];
  annotationId: string;
  conversationId?: string;
  messageId?: string;
  requestId?: string;
  author: "user" | "codex";
  body: string;
  kind?: "comment" | "highlight";
  savedAt: string;
}
export type Provider = "builtin" | "codex" | "claude" | "workbuddy";
export interface ModelOption {
  id: string; name: string; default: boolean; defaultEffort: string | null;
  efforts: { id: string; name: string }[];
}
export interface ChatExcerpt {
  messageId: string;
  text: string;
  start: number;
  end: number;
}
export interface MessageComment {
  id: string;
  excerpt: ChatExcerpt;
  body: string;
}
export interface Conversation {
  draftExcerpts?: ChatExcerpt[];
  provider: Provider;
  id: string;
  title: string;
  updatedAt: string;
  draft: string;
  model: string | null;
  effort: string | null;
}
export interface Message {
  excerpts?: ChatExcerpt[];
  comments?: MessageComment[];
  provider?: Provider;
  model?: string | null;
  effort?: string | null;
  requestId?: string;
  anchor?: Anchor;
  additionalAnchors?: Anchor[];
  complete?: boolean;
  id: string;
  role: "user" | "assistant";
  text: string;
  selectedText?: string;
  page?: number;
  phase?: string;
  toolLabels?: string[];
}
export interface ImportJob {
  id: string;
  name: string;
  status: string;
  busy: boolean;
  detail?: string;
  error?: string;
  batches: { status: string; pages: number[] }[];
}
export interface LibraryPaper {
  id: string;
  title: string;
  fileName?: string;
  pages: number[];
  sourcePages?: number;
  importedAt: string;
  lastReadAt: string | null;
  readingPosition: ReadingPosition | null;
  translation: Pick<Translation, "status" | "completed" | "total"> | null;
}
export interface Snapshot {
  approvals?: { id: string; provider: Provider; operation: string; reason: string }[];
  activity?: { kind: string; label: string } | null;
  settings: { defaultAgent: Provider };
  activeConversationId: string;
  conversations: Conversation[];
  readingPosition?: ReadingPosition | null;
  paper: Paper;
  translation: Translation | null;
  translationActive: string | null;
  library: LibraryPaper[];
  annotations: Annotation[];
  messages: Message[];
  requests?: { requestId: string; status: string }[];
  threadId: string | null;
  connection: "disconnected" | "connecting" | "connected";
  busy: boolean;
  model?: string;
  error?: string;
  importJob: ImportJob | null;
}
export type ReadingMode = "zh" | "bilingual" | "en";
export interface ReadingPosition {
  paperId: string;
  documentVersion: number;
  blockId: string;
  page: number;
  sourceOffset: number;
  segmentId?: string;
  progress: number;
  viewportOffset: number;
  mode: ReadingMode;
  atTop?: boolean;
}
