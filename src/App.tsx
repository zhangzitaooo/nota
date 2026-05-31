import React, { useState, useCallback, useEffect } from 'react';
import {
  AppView,
  PaperBlock,
  PaperDocument,
  Annotation,
  ChatThread,
  TranslationProgress,
  ProjectMeta,
} from './domain/types';
import { generateId, createAnnotation, createChatThread } from './domain/utils';
import ImportScreen from './components/ImportScreen';
import TranslationProgressBar from './components/TranslationProgress';
import ReaderPane from './components/ReaderPane';
import ChatPane from './components/ChatPane';
import ProjectSidebar from './components/ProjectSidebar';

function isReferencesSection(sectionName?: string): boolean {
  return /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|参考文献)\s*[:.]?$/i.test(
    (sectionName || '').trim()
  );
}

function getTranslationProgressBlocks(blocks: PaperBlock[]): PaperBlock[] {
  let inReferences = false;
  const hiddenTypes = new Set([
    'page_header',
    'page_footer',
    'footnote',
    'visual_noise',
    'figure_asset',
    'table_asset',
    'figure_body',
    'table_body',
    'reference',
    'formula',
    'code',
  ]);

  return blocks.filter((block) => {
    if (isReferencesSection(block.en) || isReferencesSection(block.sectionPath?.[0]) || block.type === 'reference') {
      inReferences = true;
    }

    if (inReferences || hiddenTypes.has(block.type)) {
      return false;
    }

    return (block.translationPolicy || 'translate') === 'translate';
  });
}

const DOCUMENT_CONTEXT_LIMIT = 7000;

function buildDocumentQuestionContext(doc: PaperDocument): string {
  const visibleBlocks = getTranslationProgressBlocks(doc.blocks);
  const lines: string[] = [];
  const usedBlockIds = new Set<string>();
  let remaining = DOCUMENT_CONTEXT_LIMIT;

  const appendLine = (line: string) => {
    if (remaining <= 0) return;
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const clipped = normalized.slice(0, remaining);
    lines.push(clipped);
    remaining -= clipped.length + 1;
  };

  const appendBlock = (block: PaperBlock, prefix = '-') => {
    if (usedBlockIds.has(block.id)) return;
    const text = (block.zh || block.en || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    usedBlockIds.add(block.id);
    appendLine(`${prefix} ${text}`);
  };

  appendLine(`论文标题：${doc.paper.title}`);

  const headingTexts = visibleBlocks
    .filter((block) => block.type === 'heading')
    .map((block) => (block.zh || block.en || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const uniqueHeadings = [...new Set(headingTexts)].slice(0, 24);
  if (uniqueHeadings.length > 0) {
    appendLine('章节结构：' + uniqueHeadings.join(' / '));
  }

  const abstractBlocks = visibleBlocks.filter((block) => block.type === 'abstract').slice(0, 6);
  if (abstractBlocks.length > 0) {
    appendLine('摘要相关段落：');
    abstractBlocks.forEach((block) => appendBlock(block));
  }

  const openingBlocks = visibleBlocks
    .filter((block) => ['title', 'author', 'heading', 'paragraph'].includes(block.type))
    .slice(0, 12);
  if (openingBlocks.length > 0) {
    appendLine('开头与引言摘录：');
    openingBlocks.forEach((block) => appendBlock(block));
  }

  const conclusionBlocks = visibleBlocks
    .filter((block) => {
      const sectionText = [...(block.sectionPath || []), block.en, block.zh].join(' ');
      return /(conclusion|discussion|limitation|limitations|future work|结论|讨论|局限|未来)/i.test(
        sectionText
      );
    })
    .slice(-10);
  if (conclusionBlocks.length > 0) {
    appendLine('讨论/结论/局限相关摘录：');
    conclusionBlocks.forEach((block) => appendBlock(block));
  }

  return lines.join('\n');
}

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('home');
  const [projectId, setProjectId] = useState<string>('');
  const [document, setDocument] = useState<PaperDocument | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<Map<string, TranslationProgress>>(new Map());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const savedProjects = await window.electronAPI.listProjects();
      setProjects(savedProjects);
    } catch (error) {
      console.error('读取项目列表失败:', error);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const resetReadingContext = useCallback(() => {
    setProgress(new Map());
    setSelectedBlockId(null);
    setSelectedText('');
    setActiveChatId(null);
  }, []);

  // 处理 PDF 导入
  const handleImportPdf = useCallback(async () => {
    try {
      const pdfPath = await window.electronAPI.importPdf();
      if (!pdfPath) return;

      setView('importing');
      setTranslating(true);
      resetReadingContext();

      // 创建项目
      const { projectId } = await window.electronAPI.createProject(pdfPath);
      setProjectId(projectId);

      // 解析 PDF
      const rawBlocks = await window.electronAPI.parsePdf(pdfPath, projectId);

      // 给每个 block 加 id
      const blocks: PaperBlock[] = rawBlocks.map((b: any, i: number) => ({
        ...b,
        id: `${b.type}-${i}-${generateId().slice(0, 6)}`,
        zh: '',
        status: 'pending' as const,
        translationPolicy: b.translationPolicy || 'translate',
      }));

      // 保存初始 document
      const doc: PaperDocument = {
        paper: {
          id: projectId,
          title: rawBlocks[0]?.en || '未命名论文',
          sourcePdfPath: pdfPath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        blocks,
      };
      await window.electronAPI.saveDocument(projectId, doc);
      setDocument(doc);
      void refreshProjects();

      // 加载已有的 annotations 和 chats
      const savedAnnotations = await window.electronAPI.loadAnnotations(projectId);
      setAnnotations(savedAnnotations);
      const savedChats = await window.electronAPI.loadChats(projectId);
      setChats(savedChats);

      setView('reading');

      void (async () => {
        try {
          const translatedBlocks = await window.electronAPI.translateBlocks(projectId, blocks);
          const finalDoc: PaperDocument = {
            ...doc,
            paper: {
              ...doc.paper,
              updatedAt: new Date().toISOString(),
            },
            blocks: translatedBlocks,
          };
          await window.electronAPI.saveDocument(projectId, finalDoc);
          setDocument(finalDoc);
          void refreshProjects();
        } catch (error) {
          console.error('后台翻译失败:', error);
        } finally {
          setTranslating(false);
        }
      })();
    } catch (error: any) {
      console.error('导入失败:', error);
      alert('导入论文失败: ' + error.message);
      setTranslating(false);
      setView('home');
    }
  }, [refreshProjects, resetReadingContext]);

  const handleOpenProject = useCallback(
    async (nextProjectId: string) => {
      try {
        setTranslating(false);
        resetReadingContext();

        const [savedDocument, savedAnnotations, savedChats] = await Promise.all([
          window.electronAPI.loadDocument(nextProjectId),
          window.electronAPI.loadAnnotations(nextProjectId),
          window.electronAPI.loadChats(nextProjectId),
        ]);

        if (!savedDocument) {
          alert('这个项目还没有可读取的论文内容，请重新导入。');
          return;
        }

        setProjectId(nextProjectId);
        setDocument(savedDocument);
        setAnnotations(savedAnnotations);
        setChats(savedChats);
        setView('reading');
      } catch (error: any) {
        console.error('打开项目失败:', error);
        alert('打开论文失败: ' + error.message);
      }
    },
    [resetReadingContext]
  );

  const handleDeleteProject = useCallback(
    async (targetProjectId: string) => {
      try {
        await window.electronAPI.deleteProject(targetProjectId);

        if (targetProjectId === projectId) {
          setView('home');
          setProjectId('');
          setDocument(null);
          setAnnotations([]);
          setChats([]);
          setTranslating(false);
          setSidebarOpen(false);
          resetReadingContext();
        }

        await refreshProjects();
      } catch (error: any) {
        console.error('删除项目失败:', error);
        alert('删除文件失败: ' + error.message);
      }
    },
    [projectId, refreshProjects, resetReadingContext]
  );

  // 监听翻译进度
  useEffect(() => {
    if (!window.electronAPI?.onTranslationProgress) {
      return;
    }

    const cleanup = window.electronAPI.onTranslationProgress((data) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(data.blockId, data);
        return next;
      });

      // 实时更新 document 中的 block 状态
      setDocument((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blocks: prev.blocks.map((b) => {
            if (b.id === data.blockId) {
              return {
                ...b,
                status: data.status,
                zh: data.zh || b.zh,
                error: data.error,
              };
            }
            return b;
          }),
        };
      });
    });
    return cleanup;
  }, []);

  // 处理标注
  const handleAddAnnotation = useCallback(
    async (blockId: string, type: 'highlight' | 'bold', start: number, end: number, text: string) => {
      const annotation = createAnnotation(blockId, type, start, end, text);
      const newAnnotations = [...annotations, annotation];
      setAnnotations(newAnnotations);
      if (projectId) {
        await window.electronAPI.saveAnnotations(projectId, newAnnotations);
      }
    },
    [annotations, projectId]
  );

  // 处理删除标注
  const handleRemoveAnnotation = useCallback(
    async (annotationId: string) => {
      const newAnnotations = annotations.filter((a) => a.id !== annotationId);
      setAnnotations(newAnnotations);
      if (projectId) {
        await window.electronAPI.saveAnnotations(projectId, newAnnotations);
      }
    },
    [annotations, projectId]
  );

  // 处理选中文本询问 AI
  const handleAskAI = useCallback(
    (blockId: string, text: string) => {
      setSelectedBlockId(blockId);
      setSelectedText(text);
      setActiveChatId(null);
    },
    []
  );

  const handleClearSelection = useCallback(() => {
    setSelectedBlockId(null);
    setSelectedText('');
    setActiveChatId(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const translateTargetBlocks = useCallback(async (targetBlocks: PaperBlock[], failureMessage: string) => {
    if (!document || !projectId || translating) return;
    if (targetBlocks.length === 0) return;

    setTranslating(true);
    let nextBlocks = document.blocks;

    const updateBlock = async (blockId: string, patch: Partial<PaperBlock>) => {
      nextBlocks = nextBlocks.map((block) =>
        block.id === blockId ? { ...block, ...patch } : block
      );

      const nextDocument: PaperDocument = {
        ...document,
        paper: {
          ...document.paper,
          updatedAt: new Date().toISOString(),
        },
        blocks: nextBlocks,
      };

      setDocument(nextDocument);
      await window.electronAPI.saveDocument(projectId, nextDocument);
    };

    try {
      for (const block of targetBlocks) {
        await updateBlock(block.id, {
          status: 'translating',
          error: undefined,
        });

        const translatedBlock = await window.electronAPI.retryTranslateBlock({
          ...block,
          status: 'translating',
          error: undefined,
        });

        await updateBlock(block.id, translatedBlock);
      }

      void refreshProjects();
    } catch (error: any) {
      console.error(failureMessage, error);
      alert(failureMessage + ': ' + error.message);
    } finally {
      setTranslating(false);
    }
  }, [document, projectId, refreshProjects, translating]);

  const handleRetryFailedTranslations = useCallback(async () => {
    if (!document) return;

    const failedBlocks = getTranslationProgressBlocks(document.blocks).filter(
      (block) => block.status === 'failed'
    );

    await translateTargetBlocks(failedBlocks, '重试翻译失败');
  }, [document, translateTargetBlocks]);

  const handleContinueTranslations = useCallback(async () => {
    if (!document) return;

    const pendingBlocks = getTranslationProgressBlocks(document.blocks).filter(
      (block) => block.status === 'pending'
    );

    await translateTargetBlocks(pendingBlocks, '继续翻译失败');
  }, [document, translateTargetBlocks]);

  const handleExportPdf = useCallback(async () => {
    if (!projectId || exportingPdf) return;

    setExportingPdf(true);
    try {
      const result = await window.electronAPI.exportPdf(projectId);
      if (result.status === 'success') {
        alert(`PDF 已导出：${result.filePath}`);
      }
    } catch (error: any) {
      console.error('导出 PDF 失败:', error);
      alert('导出 PDF 失败: ' + error.message);
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf, projectId]);

  // 处理发送 Chat 消息
  const handleSendChat = useCallback(
    async (question: string) => {
      if (!document) return;

      const existingActiveChat = activeChatId
        ? chats.find((c) => c.id === activeChatId)
        : null;
      const targetBlockId = selectedBlockId || existingActiveChat?.blockId || '__document__';
      const targetSelectedText = selectedText || existingActiveChat?.selectedText || '';

      const block = document.blocks.find((b) => b.id === targetBlockId);
      const isDocumentLevelChat = targetBlockId === '__document__';
      if (!block && !isDocumentLevelChat) return;

      // 查找或创建 ChatThread
      let isNewThread = false;
      let thread = chats.find(
        (c) => c.blockId === targetBlockId && c.selectedText === targetSelectedText
      );

      if (!thread) {
        isNewThread = true;
        thread = createChatThread(targetBlockId, targetSelectedText, {
          paperTitle: document.paper.title,
          sectionPath: block?.sectionPath || [],
          zhBlock: block?.zh || '',
          enBlock: block?.en || '',
        });
      }

      const chatHistory = thread.messages
        .filter((message) => message.status !== 'pending' && message.status !== 'error')
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      // 添加用户消息
      const userMsg = {
        id: generateId(),
        role: 'user' as const,
        content: question,
        createdAt: new Date().toISOString(),
      };
      const pendingAssistantMsg = {
        id: generateId(),
        role: 'assistant' as const,
        content: '思考中...',
        createdAt: new Date().toISOString(),
        status: 'pending' as const,
      };

      const threadWithUser = {
        ...thread,
        messages: [...thread.messages, userMsg],
        updatedAt: new Date().toISOString(),
      };

      // 更新本地状态
      const newChats = isNewThread
        ? [...chats, threadWithUser]
        : chats.map((c) => (c.id === thread.id ? threadWithUser : c));
      setChats(newChats);
      setActiveChatId(threadWithUser.id);

      if (projectId) {
        await window.electronAPI.saveChats(projectId, newChats);
      }

      const chatsWithPending = newChats.map((c) =>
        c.id === threadWithUser.id
          ? {
              ...threadWithUser,
              messages: [...threadWithUser.messages, pendingAssistantMsg],
            }
          : c
      );
      setChats(chatsWithPending);

      // 调用 AI
      try {
        const answer = await window.electronAPI.chatAsk({
          paperTitle: document.paper.title,
          sectionPath: block?.sectionPath || [],
          selectedText: targetSelectedText,
          zhBlock: block?.zh || '',
          enBlock: block?.en || '',
          documentContext: block ? '' : buildDocumentQuestionContext(document),
          question,
          chatHistory,
        });

        const assistantMsg = {
          id: generateId(),
          role: 'assistant' as const,
          content: answer,
          createdAt: new Date().toISOString(),
          status: 'done' as const,
        };

        const threadWithAnswer = {
          ...threadWithUser,
          messages: [...threadWithUser.messages, assistantMsg],
          updatedAt: new Date().toISOString(),
        };

        const finalChats = newChats.map((c) =>
          c.id === threadWithUser.id ? threadWithAnswer : c
        );
        setChats(finalChats);

        if (projectId) {
          await window.electronAPI.saveChats(projectId, finalChats);
        }
      } catch (error: any) {
        console.error('AI 回答失败:', error);
        const errorMsg = {
          id: generateId(),
          role: 'assistant' as const,
          content: '回答失败，请稍后重试。',
          createdAt: new Date().toISOString(),
          status: 'error' as const,
        };
        const threadWithError = {
          ...threadWithUser,
          messages: [...threadWithUser.messages, errorMsg],
          updatedAt: new Date().toISOString(),
        };
        const errorChats = newChats.map((c) =>
          c.id === threadWithUser.id ? threadWithError : c
        );
        setChats(errorChats);
      }
    },
    [document, selectedBlockId, selectedText, activeChatId, chats, projectId]
  );

  // 获取进度统计
  const progressBlocks = getTranslationProgressBlocks(document?.blocks || []);
  const progressStats = {
    total: progressBlocks.length,
    done: progressBlocks.filter((b) => b.status === 'done').length,
    failed: progressBlocks.filter((b) => b.status === 'failed').length,
    translating: progressBlocks.filter((b) => b.status === 'translating').length,
    pending: progressBlocks.filter((b) => b.status === 'pending').length,
  };
  const progressPercent =
    progressStats.total > 0 ? Math.round((progressStats.done / progressStats.total) * 100) : 0;
  const showWorkspaceProgress =
    progressStats.total > 0 &&
    (progressStats.pending > 0 ||
      progressStats.translating > 0 ||
      progressStats.failed > 0);

  return (
    <div className="app">
      {view === 'home' && (
        <ImportScreen
          onImport={handleImportPdf}
          projects={projects}
          loadingProjects={loadingProjects}
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      {view === 'importing' && (
        <TranslationProgressBar stats={progressStats} />
      )}

      {view === 'reading' && document && (
        <div className={`workspace ${sidebarOpen ? 'sidebar-open' : ''}`}>
          {sidebarOpen && (
            <ProjectSidebar
              projects={projects}
              activeProjectId={projectId}
              onImport={handleImportPdf}
              onOpenProject={handleOpenProject}
              onDeleteProject={handleDeleteProject}
              onClose={() => setSidebarOpen(false)}
            />
          )}
          <div className="workspace-main">
            <div className="workspace-header">
              <div className="workspace-header-left">
                <button
                  className="icon-button"
                  onClick={() => setSidebarOpen((open) => !open)}
                  title={sidebarOpen ? '收起文件栏' : '展开文件栏'}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M4 6h16" />
                    <path d="M4 12h16" />
                    <path d="M4 18h16" />
                  </svg>
                </button>
                <h1 className="paper-title">{document.paper.title}</h1>
              </div>
              <button
                className="btn-export"
                onClick={handleExportPdf}
                disabled={exportingPdf}
                title={exportingPdf ? '正在导出 PDF' : '导出 PDF'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-7" />
                  <path d="M9 14l3-3 3 3" />
                </svg>
                <span>导出</span>
              </button>
            </div>
            {showWorkspaceProgress && (
              <div className="workspace-progress">
                <div className="workspace-progress-copy">
                  <span>
                    {translating
                      ? progressStats.translating > 0 || progressStats.pending > 0
                        ? '正在后台翻译'
                        : '整理翻译结果'
                      : progressStats.failed > 0
                        ? '翻译完成，部分失败'
                        : '翻译已暂停'}
                  </span>
                  <div className="workspace-progress-meta">
                    <span>
                      {progressStats.done} / {progressStats.total} 段
                      {progressStats.translating > 0 && ` · ${progressStats.translating} 段翻译中`}
                      {progressStats.failed > 0 && ` · ${progressStats.failed} 段失败`}
                    </span>
                    {progressStats.failed > 0 && !translating && (
                      <button
                        className="workspace-progress-retry"
                        onClick={handleRetryFailedTranslations}
                      >
                        重试
                      </button>
                    )}
                    {progressStats.pending > 0 && progressStats.failed === 0 && !translating && (
                      <button
                        className="workspace-progress-retry"
                        onClick={handleContinueTranslations}
                      >
                        继续
                      </button>
                    )}
                  </div>
                </div>
                <div className="workspace-progress-bar" aria-label="翻译进度">
                  <div
                    className="workspace-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
            <div className="workspace-body">
              <ReaderPane
                projectId={projectId}
                blocks={document.blocks}
                annotations={annotations}
                selectedBlockId={selectedBlockId}
                onAddAnnotation={handleAddAnnotation}
                onRemoveAnnotation={handleRemoveAnnotation}
                onAskAI={handleAskAI}
              />
              <ChatPane
                chats={chats}
                activeChatId={activeChatId}
                selectedText={selectedText}
                onSend={handleSendChat}
                onSelectChat={(chatId) => setActiveChatId(chatId)}
                onClearSelection={handleClearSelection}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
