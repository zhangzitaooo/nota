import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件导入
  importPdf: () => ipcRenderer.invoke('import-pdf'),

  // 项目操作
  createProject: (pdfPath: string) => ipcRenderer.invoke('create-project', pdfPath),
  loadProject: (projectId: string) => ipcRenderer.invoke('load-project', projectId),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),

  // PDF 解析
  parsePdf: (pdfPath: string, projectId?: string) => ipcRenderer.invoke('parse-pdf', pdfPath, projectId),
  loadAssetDataUrl: (projectId: string, assetPath: string) =>
    ipcRenderer.invoke('load-asset-data-url', projectId, assetPath),
  exportPdf: (projectId: string) => ipcRenderer.invoke('export-pdf', projectId),

  // 翻译
  translateBlocks: (projectId: string, blocks: any[]) =>
    ipcRenderer.invoke('translate-blocks', projectId, blocks),
  retryTranslateBlock: (block: any) => ipcRenderer.invoke('retry-translate-block', block),

  // Document
  saveDocument: (projectId: string, document: any) =>
    ipcRenderer.invoke('save-document', projectId, document),
  loadDocument: (projectId: string) => ipcRenderer.invoke('load-document', projectId),

  // Annotations
  saveAnnotations: (projectId: string, annotations: any[]) =>
    ipcRenderer.invoke('save-annotations', projectId, annotations),
  loadAnnotations: (projectId: string) => ipcRenderer.invoke('load-annotations', projectId),

  // Chats
  saveChats: (projectId: string, chats: any[]) =>
    ipcRenderer.invoke('save-chats', projectId, chats),
  loadChats: (projectId: string) => ipcRenderer.invoke('load-chats', projectId),

  // AI Chat
  chatAsk: (context: any) => ipcRenderer.invoke('chat-ask', context),

  // 事件监听
  onTranslationProgress: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('translation-progress', listener);
    return () => ipcRenderer.removeListener('translation-progress', listener);
  },
});
