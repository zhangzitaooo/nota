import React, { useRef, useCallback, useEffect, useState } from 'react';
import { PaperBlock, Annotation, AnnotationType } from '../domain/types';
import { renderBlockHtml, getSelectionInBlock } from '../domain/utils';
import SelectionToolbar from './SelectionToolbar';

interface ReaderPaneProps {
  projectId: string;
  blocks: PaperBlock[];
  annotations: Annotation[];
  selectedBlockId: string | null;
  onAddAnnotation: (
    blockId: string,
    type: 'highlight' | 'bold',
    start: number,
    end: number,
    text: string
  ) => void;
  onRemoveAnnotation: (annotationId: string) => void;
  onAskAI: (blockId: string, selectedText: string) => void;
}

interface FigureAssetProps {
  projectId: string;
  block: PaperBlock;
}

interface ToolbarState {
  visible: boolean;
  x: number;
  y: number;
  blockId: string;
  selectedText: string;
  start: number;
  end: number;
}

function closestBlockElement(node: Node | null, container: HTMLElement): HTMLElement | null {
  const element =
    node instanceof HTMLElement ? node : node?.parentElement;
  const blockElement = element?.closest<HTMLElement>('[data-block-id]');
  return blockElement && container.contains(blockElement) ? blockElement : null;
}

function getSelectionAnchorRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  return rects[0] || range.getBoundingClientRect();
}

function isReferencesSection(sectionName?: string): boolean {
  return /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|参考文献)\s*[:.]?$/i.test(
    (sectionName || '').trim()
  );
}

const FigureAsset: React.FC<FigureAssetProps> = ({ projectId, block }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!block.assetPath) {
      setSrc(null);
      return;
    }

    void window.electronAPI.loadAssetDataUrl(projectId, block.assetPath).then((dataUrl) => {
      if (!cancelled) {
        setSrc(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [block.assetPath, projectId]);

  if (!src) {
    return (
      <div className="figure-asset-placeholder">
        {block.type === 'table_asset' ? '表格区域已跳过' : '图表区域已跳过'}
      </div>
    );
  }

  return (
    <figure className="figure-asset">
      <img src={src} alt={block.type === 'table_asset' ? '论文表格' : '论文图表'} />
    </figure>
  );
};

const ReaderPane: React.FC<ReaderPaneProps> = ({
  projectId,
  blocks,
  annotations,
  selectedBlockId,
  onAddAnnotation,
  onRemoveAnnotation,
  onAskAI,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  let inReferences = false;
  const visibleBlocks = blocks.filter((block) => {
    if (isReferencesSection(block.en) || isReferencesSection(block.sectionPath?.[0]) || block.type === 'reference') {
      inReferences = true;
    }

    if (inReferences) return false;

    return (
      (block.translationPolicy !== 'skip' || block.type === 'figure_asset' || block.type === 'table_asset') &&
      ![
        'page_header',
        'page_footer',
        'footnote',
        'visual_noise',
              'figure_body',
              'table_body',
              'reference',
            ].includes(block.type)
    );
  });
  const [toolbar, setToolbar] = useState<ToolbarState>({
    visible: false,
    x: 0,
    y: 0,
    blockId: '',
    selectedText: '',
    start: 0,
    end: 0,
  });

  // 处理文本选择
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      // 延迟关闭，防止点击标注时立即消失
      setTimeout(() => {
        setToolbar((prev) => ({ ...prev, visible: false }));
      }, 200);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const range = selection.getRangeAt(0);
    const startBlockEl = closestBlockElement(range.startContainer, container);
    const endBlockEl = closestBlockElement(range.endContainer, container);
    const selectedText = range.toString().trim();
    if (!selectedText || !startBlockEl) {
      setToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    const contextBlockId = startBlockEl.dataset.blockId;
    const contextBlock = blocks.find((item) => item.id === contextBlockId);
    if (!contextBlock) {
      setToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    onAskAI(contextBlock.id, selectedText);

    const isSingleBlockSelection = Boolean(
      startBlockEl &&
      endBlockEl &&
      startBlockEl === endBlockEl
    );
    if (!isSingleBlockSelection || !contextBlock.zh) {
      setToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    const result = getSelectionInBlock(selection, startBlockEl);
    if (!result) {
      setToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    const rect = getSelectionAnchorRect(range);
    const toolbarX = Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48);
    const toolbarY = Math.max(rect.top - 8, 52);

    setToolbar({
      visible: true,
      x: toolbarX,
      y: toolbarY,
      blockId: contextBlock.id,
      selectedText: result.text,
      start: result.start,
      end: result.end,
    });
  }, [blocks, onAskAI]);

  // 处理标注按钮点击
  const handleAnnotate = useCallback(
    (type: AnnotationType) => {
      onAddAnnotation(toolbar.blockId, type, toolbar.start, toolbar.end, toolbar.selectedText);
      setToolbar((prev) => ({ ...prev, visible: false }));
      window.getSelection()?.removeAllRanges();
    },
    [toolbar, onAddAnnotation]
  );

  // 处理点击 annotation 删除
  const handleAnnotationClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const annotationEl = target.closest('[data-annotation-id]');
      if (annotationEl) {
        const annotationId = annotationEl.getAttribute('data-annotation-id');
        if (annotationId && confirm('删除此标注？')) {
          onRemoveAnnotation(annotationId);
        }
      }
    },
    [onRemoveAnnotation]
  );

  return (
    <div className="reader-pane" ref={containerRef} onMouseUp={handleMouseUp}>
      {toolbar.visible && (
        <SelectionToolbar
          x={toolbar.x}
          y={toolbar.y}
          onAnnotate={handleAnnotate}
        />
      )}

      {/* 阅读内容 */}
      <div className="reader-content" onClick={handleAnnotationClick}>
        {visibleBlocks.map((block, index) => {
          const isAuthorBlock =
            block.type === 'paragraph' &&
            index > 0 &&
            visibleBlocks[index - 1]?.type === 'title';

          return (
          <div
            key={block.id}
            data-block-id={block.id}
            className={`block block-${block.type} ${
              isAuthorBlock ? 'block-author' : ''
            } block-status-${block.status} ${
              selectedBlockId === block.id ? 'block-selected' : ''
            } ${block.zh ? '' : 'block-source-fallback'}`}
          >
            {block.type === 'title' && (
              <h2
                className="block-title"
                dangerouslySetInnerHTML={{
                  __html: renderBlockHtml(block, annotations),
                }}
              />
            )}

            {block.type === 'heading' && (
              <h3
                className="block-heading"
                dangerouslySetInnerHTML={{
                  __html: renderBlockHtml(block, annotations),
                }}
              />
            )}

            {(block.type === 'figure_asset' || block.type === 'table_asset') && (
              <FigureAsset projectId={projectId} block={block} />
            )}

            {(block.type === 'paragraph' ||
              block.type === 'abstract' ||
              block.type === 'figure_caption' ||
              block.type === 'table_caption' ||
              block.type === 'reference') && (
              <p
                className={`block-text ${
                  block.type === 'figure_caption' || block.type === 'table_caption' ? 'block-caption' : ''
                } ${block.type === 'reference' ? 'block-reference' : ''}`}
                dangerouslySetInnerHTML={{
                  __html: renderBlockHtml(block, annotations),
                }}
              />
            )}

            {block.type === 'formula' && (
              <div className="block-formula">{block.en}</div>
            )}

            {/* 翻译状态指示 */}
            {block.status === 'translating' && (
              <span className="block-status-badge translating">翻译中...</span>
            )}
            {block.status === 'failed' && (
              <span className="block-status-badge failed" title={block.error}>
                翻译失败
              </span>
            )}
            {block.status === 'pending' && (
              <span className="block-status-badge pending">等待翻译</span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReaderPane;
