import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import { ProjectStore } from './project-store';

type ExportPdfResult =
  | { status: 'success'; filePath: string }
  | { status: 'cancelled' };

interface PaperBlock {
  id: string;
  type: string;
  sectionPath?: string[];
  page?: number;
  order: number;
  en: string;
  zh: string;
  translationPolicy?: string;
  assetPath?: string;
}

interface PaperDocument {
  paper: {
    title: string;
  };
  blocks: PaperBlock[];
}

interface Annotation {
  id: string;
  blockId: string;
  type: 'highlight' | 'bold';
  start: number;
  end: number;
}

export class PdfExporter {
  constructor(
    private projectStore: ProjectStore,
    private getParentWindow: () => BrowserWindow | null
  ) {}

  async exportProjectToPdf(projectId: string): Promise<ExportPdfResult> {
    const document = this.projectStore.loadDocument(projectId) as PaperDocument | null;
    if (!document) {
      throw new Error('没有可导出的论文内容');
    }

    const annotations = this.projectStore.loadAnnotations(projectId) as Annotation[];
    const defaultPath = path.join(
      app.getPath('downloads'),
      `${this.toSafeFileName(document.paper.title || '论文导出')}.pdf`
    );

    const saveOptions = {
      title: '导出 PDF',
      defaultPath,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    };
    const parentWindow = this.getParentWindow();
    const saveResult = parentWindow
      ? await dialog.showSaveDialog(parentWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (saveResult.canceled || !saveResult.filePath) {
      return { status: 'cancelled' };
    }

    const filePath = saveResult.filePath.toLowerCase().endsWith('.pdf')
      ? saveResult.filePath
      : `${saveResult.filePath}.pdf`;
    const html = this.buildExportHtml(projectId, document, annotations);
    await this.renderHtmlToPdf(html, filePath);

    return { status: 'success', filePath };
  }

  private buildExportHtml(
    projectId: string,
    document: PaperDocument,
    annotations: Annotation[]
  ): string {
    const readableBlocks = this.getReadableBlocks(document.blocks);
    const contentBlocks = this.removeDuplicatedTitleBlock(readableBlocks, document.paper.title);
    const content = contentBlocks
      .map((block) => this.renderBlock(projectId, block, annotations))
      .join('\n');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${this.escapeHtml(document.paper.title || '论文导出')}</title>
  <style>
    @page {
      margin: 22mm 20mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      margin: 0;
      color: #111;
      font-family: "Songti SC", "Noto Serif CJK SC", "Times New Roman", serif;
      font-size: 12.5pt;
      line-height: 1.82;
      background: #fff;
    }

    .export-document {
      width: 100%;
    }

    h1.export-paper-title {
      margin: 0 0 28px;
      font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 18pt;
      font-weight: 600;
      line-height: 1.35;
      text-align: center;
    }

    h2.block-title {
      margin: 0 0 18px;
      font-size: 18pt;
      font-weight: 700;
      line-height: 1.4;
      text-align: center;
    }

    h3.block-heading {
      margin: 28px 0 12px;
      font-size: 15pt;
      font-weight: 700;
      line-height: 1.5;
    }

    p.block-text {
      margin: 0 0 12px;
      text-indent: 2em;
      white-space: pre-wrap;
    }

    p.block-caption {
      margin: 10px 0 16px;
      color: #555;
      font-size: 11.5pt;
      font-style: italic;
      text-indent: 0;
    }

    p.block-author {
      margin: -8px 0 24px;
      font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11.5pt;
      font-weight: 500;
      line-height: 1.6;
      text-align: center;
      text-indent: 0;
    }

    .block-formula {
      margin: 14px 0;
      text-align: center;
      font-family: "Courier New", monospace;
      white-space: pre-wrap;
    }

    mark.annotation-highlight {
      background: #fff1a8;
      background-color: #fff1a8;
      color: inherit;
      padding: 0 1px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    strong.annotation-bold {
      font-weight: 700;
    }

    figure.visual-asset {
      margin: 18px 0 10px;
      text-align: center;
      break-inside: avoid;
    }

    figure.visual-asset img {
      display: block;
      max-width: 100%;
      max-height: 180mm;
      margin: 0 auto;
      object-fit: contain;
    }

    .visual-placeholder {
      margin: 16px 0 10px;
      padding: 18px;
      border: 1px dashed #d9d9d9;
      border-radius: 6px;
      color: #777;
      font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 10.5pt;
      text-align: center;
      background: #f9f8f7;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <article class="export-document">
    <h1 class="export-paper-title">${this.escapeHtml(document.paper.title || '论文导出')}</h1>
    ${content}
  </article>
</body>
</html>`;
  }

  private getReadableBlocks(blocks: PaperBlock[]): PaperBlock[] {
    let inReferences = false;
    const hiddenTypes = new Set([
      'page_header',
      'page_footer',
      'footnote',
      'visual_noise',
      'figure_body',
      'table_body',
      'reference',
    ]);

    return blocks.filter((block) => {
      if (
        this.isReferencesSection(block.en) ||
        this.isReferencesSection(block.sectionPath?.[0]) ||
        block.type === 'reference'
      ) {
        inReferences = true;
      }

      if (inReferences || hiddenTypes.has(block.type)) {
        return false;
      }

      return (
        block.translationPolicy !== 'skip' ||
        block.type === 'figure_asset' ||
        block.type === 'table_asset'
      );
    });
  }

  private removeDuplicatedTitleBlock(blocks: PaperBlock[], paperTitle: string): PaperBlock[] {
    const firstBlock = blocks[0];
    if (!firstBlock || firstBlock.type !== 'title' || firstBlock.zh) {
      return blocks;
    }

    return firstBlock.en.trim() === paperTitle.trim() ? blocks.slice(1) : blocks;
  }

  private renderBlock(projectId: string, block: PaperBlock, annotations: Annotation[]): string {
    if (block.type === 'figure_asset' || block.type === 'table_asset') {
      return this.renderAssetBlock(projectId, block);
    }

    const html = this.renderAnnotatedText(block, annotations);

    switch (block.type) {
      case 'title':
        return `<h2 class="block-title">${html}</h2>`;
      case 'heading':
        return `<h3 class="block-heading">${html}</h3>`;
      case 'author':
        return `<p class="block-author">${html}</p>`;
      case 'figure_caption':
      case 'table_caption':
        return `<p class="block-text block-caption">${html}</p>`;
      case 'formula':
        return `<div class="block-formula">${this.escapeHtml(block.en || block.zh)}</div>`;
      default:
        return `<p class="block-text">${html}</p>`;
    }
  }

  private renderAssetBlock(projectId: string, block: PaperBlock): string {
    const placeholder = block.type === 'table_asset' ? '表格区域已跳过' : '图表区域已跳过';
    if (!block.assetPath) {
      return `<div class="visual-placeholder">${placeholder}</div>`;
    }

    const dataUrl = this.projectStore.readAssetDataUrl(projectId, block.assetPath);
    if (!dataUrl) {
      return `<div class="visual-placeholder">${placeholder}</div>`;
    }

    return `<figure class="visual-asset"><img src="${this.escapeAttribute(dataUrl)}" alt="${placeholder}" /></figure>`;
  }

  private renderAnnotatedText(block: PaperBlock, annotations: Annotation[]): string {
    const text = block.zh || block.en || '';
    const shouldApplyAnnotations = Boolean(block.zh);
    const blockAnnotations = shouldApplyAnnotations
      ? annotations
          .filter((annotation) => annotation.blockId === block.id)
          .sort((a, b) => a.start - b.start)
      : [];

    if (blockAnnotations.length === 0) {
      return this.escapeHtml(text);
    }

    const boundaries = new Set<number>([0, text.length]);
    for (const annotation of blockAnnotations) {
      boundaries.add(Math.max(0, Math.min(annotation.start, text.length)));
      boundaries.add(Math.max(0, Math.min(annotation.end, text.length)));
    }

    const points = [...boundaries].sort((a, b) => a - b);
    const parts: string[] = [];

    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      if (start >= end) continue;

      const segment = this.escapeHtml(text.slice(start, end));
      const activeAnnotations = blockAnnotations.filter(
        (annotation) => annotation.start < end && annotation.end > start
      );
      const highlight = activeAnnotations.find((annotation) => annotation.type === 'highlight');
      const bold = activeAnnotations.find((annotation) => annotation.type === 'bold');

      parts.push(this.wrapAnnotatedSegment(segment, highlight, bold));
    }

    return parts.join('');
  }

  private wrapAnnotatedSegment(segment: string, highlight?: Annotation, bold?: Annotation): string {
    let html = segment;

    if (bold) {
      html = `<strong class="annotation-bold">${html}</strong>`;
    }

    if (highlight) {
      html = `<mark class="annotation-highlight" style="background:#fff1a8;background-color:#fff1a8;color:inherit;padding:0 1px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${html}</mark>`;
    }

    return html;
  }

  private async renderHtmlToPdf(html: string, filePath: string): Promise<void> {
    const exportWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const htmlPath = path.join(os.tmpdir(), `paper-reading-workbench-export-${Date.now()}.html`);

    try {
      fs.writeFileSync(htmlPath, html, 'utf-8');
      await exportWindow.loadFile(htmlPath);
      const pdfData = await exportWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: {
          marginType: 'default',
        },
      });
      fs.writeFileSync(filePath, pdfData);
    } catch (error: any) {
      throw new Error(error?.message || '导出 PDF 失败');
    } finally {
      if (!exportWindow.isDestroyed()) {
        exportWindow.destroy();
      }
      try {
        if (fs.existsSync(htmlPath)) {
          fs.unlinkSync(htmlPath);
        }
      } catch {
        // Temporary file cleanup should not mask export errors.
      }
    }
  }

  private toSafeFileName(value: string): string {
    const safeName = value
      .trim()
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 100)
      .trim();

    return safeName || '论文导出';
  }

  private isReferencesSection(text?: string): boolean {
    return /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|参考文献)\s*[:.]?$/i.test(
      (text || '').trim()
    );
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttribute(text: string): string {
    return this.escapeHtml(text);
  }
}
