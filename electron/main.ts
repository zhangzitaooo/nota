import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { ProjectStore } from './services/project-store';
import { PdfParser } from './services/pdf-parser';
import { DeepSeekClient } from './services/deepseek-client';
import { Translator } from './services/translator';
import { PdfExporter } from './services/pdf-exporter';
import { LlmHarness } from './services/llm-harness';
import { DialogueManager } from './services/dialogue-manager';
import { ToolCallingHarness } from './services/tool-calling-harness';
import { ToolRegistry } from './services/tools/tool-registry';
import { WebSearchTool } from './services/tools/web-search-tool';

let mainWindow: BrowserWindow | null = null;
let projectStore: ProjectStore;
let pdfParser: PdfParser;
let deepseekClient: DeepSeekClient;
let translator: Translator;
let pdfExporter: PdfExporter;
let dialogueManager: DialogueManager;

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info';

function isBrokenPipeError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EPIPE'
  );
}

function installSafeConsole() {
  const methods: ConsoleMethod[] = ['log', 'error', 'warn', 'info'];

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      try {
        original(...args);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    }) as Console[ConsoleMethod];
  }

  const ignoreBrokenPipe = (error: NodeJS.ErrnoException) => {
    if (!isBrokenPipeError(error)) {
      return;
    }
  };

  process.stdout.on('error', ignoreBrokenPipe);
  process.stderr.on('error', ignoreBrokenPipe);
}

installSafeConsole();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '论文精读工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer:gone]', details);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function assertStringArg(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertArrayArg<T = unknown>(value: unknown, name: string): asserts value is T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${name}`);
  }
}

app.whenReady().then(() => {
  projectStore = new ProjectStore();
  pdfParser = new PdfParser();
  deepseekClient = new DeepSeekClient();
  translator = new Translator(deepseekClient);
  pdfExporter = new PdfExporter(projectStore, () => mainWindow);
  const llmHarness = new LlmHarness();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new WebSearchTool());
  const toolCallingHarness = new ToolCallingHarness(llmHarness, deepseekClient, toolRegistry);
  dialogueManager = new DialogueManager(toolCallingHarness);

  createWindow();
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpcHandlers() {
  // ========== 文件导入 ==========
  ipcMain.handle('import-pdf', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择英文论文 PDF',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ========== 项目操作 ==========
  ipcMain.handle('create-project', async (_event, pdfPath: unknown) => {
    assertStringArg(pdfPath, 'pdfPath');
    return projectStore.createProject(pdfPath);
  });

  ipcMain.handle('load-project', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.loadProject(projectId);
  });

  ipcMain.handle('list-projects', async () => {
    return projectStore.listProjects();
  });

  ipcMain.handle('delete-project', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.deleteProject(projectId);
  });

  // ========== PDF 解析 ==========
  ipcMain.handle('parse-pdf', async (_event, pdfPath: unknown, projectId?: unknown) => {
    assertStringArg(pdfPath, 'pdfPath');
    if (projectId !== undefined) {
      assertStringArg(projectId, 'projectId');
    }
    const assetDir = projectId ? projectStore.getAssetsDir(projectId) : undefined;
    return pdfParser.parse(pdfPath, assetDir);
  });

  ipcMain.handle('load-asset-data-url', async (_event, projectId: unknown, assetPath: unknown) => {
    assertStringArg(projectId, 'projectId');
    assertStringArg(assetPath, 'assetPath');
    return projectStore.readAssetDataUrl(projectId, assetPath);
  });

  ipcMain.handle('export-pdf', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return pdfExporter.exportProjectToPdf(projectId);
  });

  // ========== 翻译 ==========
  ipcMain.handle('translate-blocks', async (_event, projectId: unknown, blocks: unknown) => {
    assertStringArg(projectId, 'projectId');
    assertArrayArg<any>(blocks, 'blocks');
    let currentBlocks = [...blocks];
    const onProgress = (blockId: string, status: string, zh?: string, error?: string) => {
      currentBlocks = currentBlocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              status,
              zh: zh ?? block.zh,
              error,
            }
          : block
      );

      try {
        const currentDocument = projectStore.loadDocument(projectId);
        if (currentDocument) {
          projectStore.saveDocument(projectId, {
            ...currentDocument,
            blocks: currentBlocks,
            paper: {
              ...currentDocument.paper,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      } catch (saveError) {
        console.error('[translation:save-progress-failed]', saveError);
      }

      mainWindow?.webContents.send('translation-progress', {
        projectId,
        blockId,
        status,
        zh,
        error,
      });
    };

    const translatedBlocks = await translator.translateAll(blocks, onProgress);
    return translatedBlocks;
  });

  ipcMain.handle('retry-translate-block', async (_event, block: any) => {
    return translator.translateBlock(block);
  });

  // ========== Document 读写 ==========
  ipcMain.handle('save-document', async (_event, projectId: unknown, document: any) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.saveDocument(projectId, document);
  });

  ipcMain.handle('load-document', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.loadDocument(projectId);
  });

  // ========== Annotations 读写 ==========
  ipcMain.handle('save-annotations', async (_event, projectId: unknown, annotations: unknown) => {
    assertStringArg(projectId, 'projectId');
    assertArrayArg(annotations, 'annotations');
    return projectStore.saveAnnotations(projectId, annotations);
  });

  ipcMain.handle('load-annotations', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.loadAnnotations(projectId);
  });

  // ========== Chat 读写 ==========
  ipcMain.handle('save-chats', async (_event, projectId: unknown, chats: unknown) => {
    assertStringArg(projectId, 'projectId');
    assertArrayArg(chats, 'chats');
    return projectStore.saveChats(projectId, chats);
  });

  ipcMain.handle('load-chats', async (_event, projectId: unknown) => {
    assertStringArg(projectId, 'projectId');
    return projectStore.loadChats(projectId);
  });

  // ========== AI Chat ==========
  ipcMain.handle('chat-ask', async (_event, context: any) => {
    const answer = await dialogueManager.answer(context);
    return answer.content;
  });
}
