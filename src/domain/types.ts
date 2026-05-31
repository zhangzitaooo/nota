// ==================== Document 类型 ====================

export type BlockType =
  | 'title'
  | 'author'
  | 'heading'
  | 'paragraph'
  | 'abstract'
  | 'figure_asset'
  | 'table_asset'
  | 'figure_caption'
  | 'table_caption'
  | 'figure_body'
  | 'table_body'
  | 'formula'
  | 'code'
  | 'reference'
  | 'footnote'
  | 'page_header'
  | 'page_footer'
  | 'visual_noise';

export type TranslationPolicy = 'translate' | 'keep_original' | 'skip' | 'asset';

export interface BlockQuality {
  score: number;
  reasons: string[];
}

export type BlockStatus = 'pending' | 'translating' | 'done' | 'failed';

export interface PaperBlock {
  id: string;
  type: BlockType;
  sectionPath: string[];
  page?: number;
  order: number;
  en: string;
  zh: string;
  status: BlockStatus;
  error?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  quality?: BlockQuality;
  translationPolicy?: TranslationPolicy;
  skipReason?: string;
  assetPath?: string;
  figureId?: string;
}

export interface PaperDocument {
  paper: {
    id: string;
    title: string;
    sourcePdfPath: string;
    createdAt: string;
    updatedAt: string;
  };
  blocks: PaperBlock[];
}

export interface ProjectMeta {
  id: string;
  title: string;
  sourcePdfPath: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== Annotation 类型 ====================

export type AnnotationType = 'highlight' | 'bold';

export interface Annotation {
  id: string;
  blockId: string;
  type: AnnotationType;
  start: number;
  end: number;
  selectedText: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== Chat 类型 ====================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'pending' | 'done' | 'error';
}

export interface ChatThread {
  id: string;
  blockId: string;
  selectedText: string;
  context: {
    paperTitle: string;
    sectionPath: string[];
    zhBlock: string;
    enBlock: string;
  };
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ==================== 应用状态 ====================

export type AppView = 'home' | 'importing' | 'reading';

export interface TranslationProgress {
  projectId: string;
  blockId: string;
  status: BlockStatus;
  zh?: string;
  error?: string;
}

export type ExportPdfResult =
  | { status: 'success'; filePath: string }
  | { status: 'cancelled' };

// ==================== Electron API 类型 ====================

export interface ElectronAPI {
  importPdf: () => Promise<string | null>;
  createProject: (pdfPath: string) => Promise<{ projectId: string; projectDir: string }>;
  loadProject: (projectId: string) => Promise<ProjectMeta | null>;
  listProjects: () => Promise<ProjectMeta[]>;
  deleteProject: (projectId: string) => Promise<void>;
  parsePdf: (pdfPath: string, projectId?: string) => Promise<any[]>;
  loadAssetDataUrl: (projectId: string, assetPath: string) => Promise<string | null>;
  exportPdf: (projectId: string) => Promise<ExportPdfResult>;
  translateBlocks: (projectId: string, blocks: any[]) => Promise<any[]>;
  retryTranslateBlock: (block: any) => Promise<any>;
  saveDocument: (projectId: string, document: any) => Promise<void>;
  loadDocument: (projectId: string) => Promise<any>;
  saveAnnotations: (projectId: string, annotations: any[]) => Promise<void>;
  loadAnnotations: (projectId: string) => Promise<any[]>;
  saveChats: (projectId: string, chats: any[]) => Promise<void>;
  loadChats: (projectId: string) => Promise<any[]>;
  chatAsk: (context: any) => Promise<string>;
  onTranslationProgress: (callback: (data: TranslationProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
