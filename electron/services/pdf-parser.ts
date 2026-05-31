import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';
import { BrowserWindow } from 'electron';

interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
}

type BlockType =
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

type TranslationPolicy = 'translate' | 'keep_original' | 'skip' | 'asset';

interface RawBlock {
  type: BlockType;
  en: string;
  page: number;
  sectionPath: string[];
  order: number;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  quality: {
    score: number;
    reasons: string[];
  };
  translationPolicy: TranslationPolicy;
  skipReason?: string;
  assetPath?: string;
  figureId?: string;
}

interface TextRun {
  text: string;
  page: number;
  y: number;
  x: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

interface ReadingLine {
  text: string;
  page: number;
  y: number;
  x: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  column: number;
}

interface QualityResult {
  score: number;
  reasons: string[];
}

interface AdmissionResult {
  type: BlockType;
  quality: QualityResult;
  translationPolicy: TranslationPolicy;
  skipReason?: string;
}

interface PageDimensions {
  width: number;
  height: number;
}

export class PdfParser {
  private pdfjsLib: any = null;
  private figureRenderWindow: BrowserWindow | null = null;

  private async ensureLib() {
    if (this.pdfjsLib) return this.pdfjsLib;

    // pdfjs-dist 4.x 的 legacy build 是 ESM 且包含 top-level await。
    // Electron main 目前编译成 CommonJS，所以这里保留原生 dynamic import，
    // 避免 TypeScript 把 import() 降级成 require()。
    const importEsm = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<any>;
    const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
    this.pdfjsLib = pdfjs;

    return this.pdfjsLib;
  }

  async parse(pdfPath: string, assetDir?: string): Promise<RawBlock[]> {
    try {
      const pdfjs = await this.ensureLib();
      const absolutePath = path.resolve(pdfPath);

      const data = new Uint8Array(fs.readFileSync(absolutePath));
      const doc = await pdfjs.getDocument({ data }).promise;

      const allTextItems: TextRun[] = [];
      const pageDimensions = new Map<number, PageDimensions>();

      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        pageDimensions.set(pageNum, {
          width: viewport.width,
          height: viewport.height,
        });
        const textContent = await page.getTextContent();

        for (const item of textContent.items) {
          const textItem = item as TextItem;
          if (!textItem.str || !textItem.str.trim()) continue;

          const y = textItem.transform[5];
          const x = textItem.transform[4];

          allTextItems.push({
            text: textItem.str,
            page: pageNum,
            y,
            x,
            width: textItem.width || 0,
            height: textItem.height || Math.abs(textItem.transform[3]) || 0,
            pageWidth: viewport.width,
            pageHeight: viewport.height,
          });
        }
      }

      const blocks = this.buildBlocks(allTextItems);
      return await this.addVisualAssets(blocks, pageDimensions, absolutePath, assetDir);
    } finally {
      this.closeFigureRenderWindow();
    }
  }

  private buildBlocks(
    items: TextRun[]
  ): RawBlock[] {
    if (items.length === 0) return [];

    const lines = this.buildReadingLines(items);
    const repeatedLines = this.getRepeatedLineTexts(lines);

    // 合并为段落（空行或大间距作为分段标志）
    const blocks: RawBlock[] = [];
    let currentParagraph = '';
    let currentPage = lines[0]?.page || 1;
    let currentBbox = this.emptyBbox();
    let currentSection = ['正文'];
    let previousLine: ReadingLine | null = null;

    const flushParagraph = () => {
      if (!currentParagraph.trim()) return;
      const text = this.cleanupParagraph(currentParagraph);
      const inferredType: BlockType =
        currentSection[0] === 'Abstract'
          ? 'abstract'
          : currentSection[0] === '参考文献'
            ? 'reference'
            : 'paragraph';
      const admission = this.assessBlock(text, inferredType);
      blocks.push({
        type: admission.type,
        en: text,
        page: currentPage,
        sectionPath: [...currentSection],
        order: blocks.length,
        bbox: currentBbox,
        quality: admission.quality,
        translationPolicy: admission.translationPolicy,
        skipReason: admission.skipReason,
      });
      currentParagraph = '';
      currentBbox = this.emptyBbox();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.text.trim();

      // 检测 References。必须早于标题检测，避免全大写 REFERENCES 被当成普通 heading。
      if (this.isReferencesHeading(trimmed)) {
        flushParagraph();
        currentSection = ['参考文献'];
        blocks.push({
          type: 'heading',
          en: trimmed,
          page: line.page,
          sectionPath: ['参考文献'],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: { score: 95, reasons: ['references heading'] },
          translationPolicy: 'skip',
          skipReason: 'references section',
        });
        previousLine = line;
        continue;
      }

      const lineAdmission = this.assessLine(line, repeatedLines);
      if (lineAdmission.translationPolicy === 'skip') {
        flushParagraph();
        blocks.push({
          type: lineAdmission.type,
          en: trimmed,
          page: line.page,
          sectionPath: [...currentSection],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: lineAdmission.quality,
          translationPolicy: 'skip',
          skipReason: lineAdmission.skipReason,
        });
        previousLine = null;
        continue;
      }

      // 标题检测。进入 References 后不要再把参考文献题名误判为章节标题。
      if (currentSection[0] !== '参考文献' && this.isLikelyTitle(trimmed, blocks.length)) {
        flushParagraph();

        if (blocks.length === 0) {
          // 论文主标题
          blocks.push({
            type: 'title',
            en: trimmed,
            page: line.page,
            sectionPath: ['标题'],
            order: blocks.length,
            bbox: this.lineBbox(line),
            quality: { score: 100, reasons: ['paper title'] },
            translationPolicy: 'translate',
          });
        } else {
          // 章节标题
          currentSection = [trimmed];
          blocks.push({
            type: 'heading',
            en: trimmed,
            page: line.page,
            sectionPath: [...currentSection],
            order: blocks.length,
            bbox: this.lineBbox(line),
            quality: { score: 95, reasons: ['section heading'] },
            translationPolicy: 'translate',
          });
        }
        previousLine = line;
        continue;
      }

      // 检测 Abstract 段落
      if (/^abstract$/i.test(trimmed) && blocks.length <= 3) {
        flushParagraph();
        currentSection = ['Abstract'];
        blocks.push({
          type: 'heading',
          en: trimmed,
          page: line.page,
          sectionPath: ['Abstract'],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: { score: 95, reasons: ['abstract heading'] },
          translationPolicy: 'translate',
        });
        previousLine = line;
        continue;
      }

      // References 之后的所有内容都跳过。参考文献格式差异很大，不只会以 [1] 开头。
      if (currentSection[0] === '参考文献') {
        flushParagraph();
        blocks.push({
          type: 'reference',
          en: trimmed,
          page: line.page,
          sectionPath: ['参考文献'],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: { score: 70, reasons: ['reference section content'] },
          translationPolicy: 'skip',
          skipReason: 'references section',
        });
        previousLine = line;
        continue;
      }

      if (this.isFigureCaption(trimmed) || this.isTableCaption(trimmed)) {
        flushParagraph();
        const type: BlockType = this.isTableCaption(trimmed) ? 'table_caption' : 'figure_caption';
        blocks.push({
          type,
          en: trimmed,
          page: line.page,
          sectionPath: [...currentSection],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: { score: 95, reasons: [`${type} detected`] },
          translationPolicy: 'translate',
        });
        previousLine = line;
        continue;
      }

      // References 之后的条目
      if (
        currentSection[0] === '参考文献' &&
        /^\[\d+\]/.test(trimmed)
      ) {
        blocks.push({
          type: 'reference',
          en: trimmed,
          page: line.page,
          sectionPath: ['参考文献'],
          order: blocks.length,
          bbox: this.lineBbox(line),
          quality: { score: 70, reasons: ['reference entry'] },
          translationPolicy: 'skip',
          skipReason: 'references section',
        });
        previousLine = line;
        continue;
      }

      if (trimmed.length === 0) {
        flushParagraph();
        previousLine = line;
        continue;
      }

      const shouldStartNewParagraph =
        previousLine &&
        currentParagraph.trim().length > 0 &&
        (previousLine.page !== line.page ||
          previousLine.column !== line.column ||
          previousLine.y - line.y > 14);

      if (shouldStartNewParagraph) {
        flushParagraph();
      }

      // 累积段落文本
      if (currentParagraph) {
        currentParagraph = this.joinLine(currentParagraph, trimmed);
      } else {
        currentParagraph = trimmed;
      }
      currentPage = line.page;
      currentBbox = this.mergeBbox(currentBbox, this.lineBbox(line));
      previousLine = line;
    }

    // 收尾最后一个段落
    flushParagraph();

    return blocks;
  }

  private async addVisualAssets(
    blocks: RawBlock[],
    pageDimensions: Map<number, PageDimensions>,
    pdfPath: string,
    assetDir?: string
  ): Promise<RawBlock[]> {
    const result: RawBlock[] = [];
    const assetCountsByPage = new Map<string, number>();

    for (const block of blocks) {
      if (!['figure_caption', 'table_caption'].includes(block.type) || !block.bbox) {
        result.push(block);
        continue;
      }

      const pageSize = pageDimensions.get(block.page);
      if (!pageSize) {
        result.push(block);
        continue;
      }

      const kind = block.type === 'table_caption' ? 'table' : 'figure';
      const assetKey = `${block.page}-${kind}`;
      const assetIndex = (assetCountsByPage.get(assetKey) || 0) + 1;
      assetCountsByPage.set(assetKey, assetIndex);
      const figureId = `page-${block.page}-${kind}-${assetIndex}`;
      const assetBlockType: BlockType = kind === 'table' ? 'table_asset' : 'figure_asset';
      const bodyBlockType: BlockType = kind === 'table' ? 'table_body' : 'figure_body';

      const candidateIndexes = this.findVisualBodyCandidateIndexes(result, block, kind);
      const candidateBlocks = candidateIndexes.map((index) => result[index]);
      const cropBbox = this.inferFigureBbox(block, candidateBlocks, pageSize);
      let assetPath: string | undefined;

      if (this.shouldRenderFigureAssets() && assetDir && cropBbox.height > 24 && cropBbox.width > 24) {
        const fileName = `page-${String(block.page).padStart(3, '0')}-${kind}-${String(assetIndex).padStart(3, '0')}.png`;
        const outputPath = path.join(assetDir, fileName);

        try {
          await this.renderPdfRegionToPng(pdfPath, block.page, cropBbox, pageSize, outputPath);
          assetPath = path.join('assets', fileName);
        } catch (error) {
          console.error(`[${kind}-asset:render-failed]`, error);
        }
      }

      for (const index of candidateIndexes) {
        result[index] = {
          ...result[index],
          type: bodyBlockType,
          translationPolicy: 'skip',
          skipReason: `${kind} body text`,
          figureId,
        };
      }

      result.push({
        type: assetBlockType,
        en: '',
        page: block.page,
        sectionPath: [...block.sectionPath],
        order: result.length,
        bbox: cropBbox,
        quality: { score: 100, reasons: [`${kind} asset`] },
        translationPolicy: 'asset',
        skipReason: `${kind} asset`,
        assetPath,
        figureId,
      });

      result.push({
        ...block,
        figureId,
      });
    }

    return result.map((block, order) => ({
      ...block,
      order,
    }));
  }

  private findVisualBodyCandidateIndexes(
    blocksBeforeCaption: RawBlock[],
    caption: RawBlock,
    kind: 'figure' | 'table'
  ): number[] {
    const indexes: number[] = [];
    const captionTop = (caption.bbox?.y || 0) + (caption.bbox?.height || 0);

    for (let index = blocksBeforeCaption.length - 1; index >= 0; index--) {
      const block = blocksBeforeCaption[index];
      if (!block.bbox || block.page !== caption.page) {
        continue;
      }

      const blockBottom = block.bbox.y;
      const blockTop = block.bbox.y + block.bbox.height;
      if (blockBottom < captionTop - 2) {
        continue;
      }

      if (['page_header', 'page_footer', 'footnote'].includes(block.type)) {
        continue;
      }

      const isLikelyVisualBody =
        block.translationPolicy === 'skip' ||
        block.type === 'visual_noise' ||
        block.quality.score < 75 ||
        this.isFigureBodyLabel(block.en) ||
        (kind === 'table' && this.isTableBodyText(block.en));

      if (isLikelyVisualBody) {
        indexes.unshift(index);
        continue;
      }

      if (['paragraph', 'abstract', 'heading', 'title'].includes(block.type) && block.quality.score >= 75) {
        break;
      }

      if (blockTop - captionTop > 360) {
        break;
      }
    }

    return indexes;
  }

  private inferFigureBbox(
    caption: RawBlock,
    candidates: RawBlock[],
    pageSize: PageDimensions
  ): { x: number; y: number; width: number; height: number } {
    const captionBox = caption.bbox!;
    const boxes = candidates
      .map((candidate) => candidate.bbox)
      .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
    const captionTop = captionBox.y + captionBox.height;
    const bottom = Math.min(pageSize.height - 24, captionTop + 6);
    const candidateTop = boxes.length
      ? Math.max(...boxes.map((box) => box.y + box.height))
      : bottom + 180;
    const top = Math.min(pageSize.height - 28, Math.max(candidateTop + 42, bottom + 80));
    const minX = Math.min(
      captionBox.x,
      boxes.length ? Math.min(...boxes.map((box) => box.x)) : captionBox.x
    );
    const maxX = boxes.length
      ? Math.max(captionBox.x + captionBox.width, ...boxes.map((box) => box.x + box.width))
      : captionBox.x + captionBox.width;
    const centerX = (minX + maxX) / 2;
    const columnWidth = pageSize.width / 2;
    const isLeftColumn = centerX < pageSize.width / 2;
    const spansWideRegion = captionBox.width > pageSize.width * 0.55 || maxX - minX > pageSize.width * 0.48;
    const x = spansWideRegion
      ? 36
      : Math.max(24, Math.min(minX - 36, isLeftColumn ? 36 : columnWidth + 12));
    const right = spansWideRegion
      ? pageSize.width - 36
      : isLeftColumn ? columnWidth - 12 : pageSize.width - 36;
    const width = Math.min(right - x, Math.max(maxX - x + 36, 260));

    return {
      x,
      y: bottom,
      width: Math.max(24, width),
      height: Math.max(24, top - bottom),
    };
  }

  private async renderPdfRegionToPng(
    pdfPath: string,
    pageNumber: number,
    bbox: { x: number; y: number; width: number; height: number },
    pageSize: PageDimensions,
    outputPath: string
  ): Promise<void> {
    const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjsWorkerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const renderWindow = await this.getFigureRenderWindow(
      Math.max(1, Math.ceil(bbox.width * 2)),
      Math.max(1, Math.ceil(bbox.height * 2))
    );

    const script = `
        (async () => {
          const fs = require('fs');
          const pdfjs = await import(${JSON.stringify(pathToFileURL(pdfjsPath).href)});
          pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(pathToFileURL(pdfjsWorkerPath).href)};
          const data = new Uint8Array(fs.readFileSync(${JSON.stringify(pdfPath)}));
          const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
          const page = await doc.getPage(${pageNumber});
          const scale = 2;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context, viewport }).promise;

          const crop = ${JSON.stringify(bbox)};
          const pageHeight = ${pageSize.height};
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = Math.max(1, Math.ceil(crop.width * scale));
          cropCanvas.height = Math.max(1, Math.ceil(crop.height * scale));
          const cropContext = cropCanvas.getContext('2d');
          cropContext.fillStyle = '#ffffff';
          cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
          cropContext.drawImage(
            canvas,
            Math.max(0, Math.floor(crop.x * scale)),
            Math.max(0, Math.floor((pageHeight - crop.y - crop.height) * scale)),
            cropCanvas.width,
            cropCanvas.height,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );
          return cropCanvas.toDataURL('image/png');
        })();
      `;
    const dataUrl = await renderWindow.webContents.executeJavaScript(script, true);
    const base64 = String(dataUrl).split(',')[1];
    if (!base64) {
      throw new Error('empty figure asset data');
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  }

  private shouldRenderFigureAssets(): boolean {
    // The BrowserWindow-based cropper can SIGTRAP Electron on macOS.
    // Keep the figure-body filtering path enabled, but require an explicit opt-in
    // before using the unstable screenshot renderer.
    return process.env.ENABLE_FIGURE_ASSET_RENDERING === '1';
  }

  private async getFigureRenderWindow(width: number, height: number): Promise<BrowserWindow> {
    if (this.figureRenderWindow && !this.figureRenderWindow.isDestroyed()) {
      this.figureRenderWindow.setSize(width, height);
      return this.figureRenderWindow;
    }

    const htmlPath = path.join(os.tmpdir(), 'paper-reading-workbench-pdf-renderer.html');
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      'utf-8'
    );

    this.figureRenderWindow = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });

    this.figureRenderWindow.on('closed', () => {
      this.figureRenderWindow = null;
    });

    await this.figureRenderWindow.loadFile(htmlPath);
    return this.figureRenderWindow;
  }

  private closeFigureRenderWindow() {
    if (this.figureRenderWindow && !this.figureRenderWindow.isDestroyed()) {
      this.figureRenderWindow.destroy();
    }
    this.figureRenderWindow = null;
  }

  private isFigureBodyLabel(text: string): boolean {
    return /^([A-Z0-9][A-Za-z0-9-]*\s+)?[+-]?\d+(\.\d+)?%?$/.test(text.trim()) ||
      /^[A-Z0-9][A-Za-z0-9-]{2,}\s+[+-]\d+(\.\d+)?$/.test(text.trim()) ||
      /^[+-]\d+(\.\d+)?\s+[A-Z0-9][A-Za-z0-9-]{2,}$/.test(text.trim());
  }

  private isTableBodyText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const numericTokens = trimmed.match(/[+-]?\d+(\.\d+)?%?/g) || [];
    const wordTokens = trimmed.match(/[A-Za-z][A-Za-z0-9-]*/g) || [];
    const shortHeaderLike = wordTokens.length >= 2 && wordTokens.length <= 8 && numericTokens.length === 0;

    return numericTokens.length >= 2 || shortHeaderLike;
  }

  private buildReadingLines(items: TextRun[]): ReadingLine[] {
    const pages = new Map<number, typeof items>();
    for (const item of items) {
      const pageItems = pages.get(item.page) || [];
      pageItems.push(item);
      pages.set(item.page, pageItems);
    }

    const result: ReadingLine[] = [];

    for (const page of Array.from(pages.keys()).sort((a, b) => a - b)) {
      const pageItems = pages.get(page)!;
      const xValues = pageItems.map((item) => item.x);
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const splitX = minX + (maxX - minX) * 0.5;
      const columns = new Map<number, typeof pageItems>();

      for (const item of pageItems) {
        const column = item.x > splitX ? 1 : 0;
        const columnItems = columns.get(column) || [];
        columnItems.push(item);
        columns.set(column, columnItems);
      }

      for (const column of Array.from(columns.keys()).sort((a, b) => a - b)) {
        const columnItems = columns.get(column)!;
        columnItems.sort((a, b) => {
          const lineA = Math.round(a.y / 4) * 4;
          const lineB = Math.round(b.y / 4) * 4;
          if (Math.abs(lineA - lineB) > 3) return lineB - lineA;
          return a.x - b.x;
        });

        const lines: Array<{ parts: typeof columnItems; y: number; x: number }> = [];
        for (const item of columnItems) {
          const lastLine = lines[lines.length - 1];
          if (lastLine && Math.abs(lastLine.y - item.y) < 5) {
            lastLine.parts.push(item);
            lastLine.y = (lastLine.y + item.y) / 2;
            lastLine.x = Math.min(lastLine.x, item.x);
          } else {
            lines.push({ parts: [item], y: item.y, x: item.x });
          }
        }

        for (const line of lines) {
          line.parts.sort((a, b) => a.x - b.x);
          const minX = Math.min(...line.parts.map((part) => part.x));
          const maxX = Math.max(...line.parts.map((part) => part.x + part.width));
          const minY = Math.min(...line.parts.map((part) => part.y));
          const maxY = Math.max(...line.parts.map((part) => part.y + part.height));
          const firstPart = line.parts[0];
          result.push({
            text: line.parts.map((part) => part.text).join(' '),
            page,
            y: line.y,
            x: line.x,
            width: Math.max(maxX - minX, 0),
            height: Math.max(maxY - minY, firstPart?.height || 0),
            pageWidth: firstPart?.pageWidth || 0,
            pageHeight: firstPart?.pageHeight || 0,
            column,
          });
        }
      }
    }

    return result;
  }

  private getRepeatedLineTexts(lines: ReadingLine[]): Set<string> {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const key = this.normalizeLineKey(line.text);
      if (!key || key.length < 10) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count >= 2)
        .map(([key]) => key)
    );
  }

  private assessLine(line: ReadingLine, repeatedLines: Set<string>): AdmissionResult {
    const text = line.text.trim();
    const normalized = this.normalizeLineKey(text);
    const topBand = line.pageHeight > 0 && line.y > line.pageHeight * 0.91;
    const bottomBand = line.pageHeight > 0 && line.y < line.pageHeight * 0.08;

    if (/^\d{1,3}$/.test(text) && (bottomBand || topBand || text.length <= 3)) {
      return this.skipAdmission('page_footer', 0, 'page number');
    }

    if (repeatedLines.has(normalized) && topBand) {
      return this.skipAdmission('page_header', 5, 'repeated page header');
    }

    if (repeatedLines.has(normalized) && bottomBand) {
      return this.skipAdmission('page_footer', 5, 'repeated page footer');
    }

    if (bottomBand && /^(\*|†|‡|correspondence|contact|equal contribution)/i.test(text)) {
      return this.skipAdmission('footnote', 30, 'footnote-like bottom text');
    }

    if (this.isFigureBodyLabel(text)) {
      return this.skipAdmission('visual_noise', 25, 'figure label-like text');
    }

    const quality = this.scoreTextQuality(text, 'paragraph');
    if (quality.score < 35) {
      return {
        type: 'visual_noise',
        quality,
        translationPolicy: 'skip',
        skipReason: quality.reasons.join('; ') || 'low-confidence line',
      };
    }

    return {
      type: 'paragraph',
      quality,
      translationPolicy: 'translate',
    };
  }

  private assessBlock(text: string, inferredType: BlockType): AdmissionResult {
    const type = this.refineBlockType(text, inferredType);
    const quality = this.scoreTextQuality(text, type);
    const translatableTypes = new Set<BlockType>([
      'title',
      'heading',
      'abstract',
      'paragraph',
      'figure_caption',
      'table_caption',
    ]);

    if (type === 'reference') {
      return {
        type,
        quality,
        translationPolicy: 'skip',
        skipReason: 'references section',
      };
    }

    if (!translatableTypes.has(type)) {
      return {
        type,
        quality,
        translationPolicy: 'skip',
        skipReason: `${type} is not translated`,
      };
    }

    if (quality.score < 60) {
      return {
        type: type === 'paragraph' ? 'visual_noise' : type,
        quality,
        translationPolicy: 'skip',
        skipReason: quality.reasons.join('; ') || 'low quality score',
      };
    }

    return {
      type,
      quality,
      translationPolicy: 'translate',
    };
  }

  private refineBlockType(text: string, fallback: BlockType): BlockType {
    if (this.isFigureCaption(text)) return 'figure_caption';
    if (this.isTableCaption(text)) return 'table_caption';
    if (this.isFormulaLike(text)) return 'formula';
    if (this.isCodeLike(text)) return 'code';
    return fallback;
  }

  private scoreTextQuality(text: string, type: BlockType): QualityResult {
    const reasons: string[] = [];
    let score = 70;
    const trimmed = text.trim();
    const tokens = trimmed.split(/\s+/).filter(Boolean);

    if (!trimmed) {
      return { score: 0, reasons: ['empty text'] };
    }

    if (/^\d{1,4}$/.test(trimmed) || /^[^\p{L}\p{N}]+$/u.test(trimmed)) {
      return { score: 0, reasons: ['pure number or symbol'] };
    }

    if (['title', 'heading', 'figure_caption', 'table_caption', 'abstract'].includes(type)) {
      score += 25;
      reasons.push(`${type} is translatable`);
    }

    const symbolChars = [...trimmed].filter((char) => /[^\p{L}\p{N}\s.,;:!?()\-–—'"]/u.test(char)).length;
    const symbolRatio = symbolChars / Math.max(trimmed.length, 1);
    if (symbolRatio > 0.28) {
      score -= 40;
      reasons.push('high symbol ratio');
    }

    const avgTokenLength =
      tokens.reduce((sum, token) => sum + token.length, 0) / Math.max(tokens.length, 1);
    if (tokens.length >= 3 && avgTokenLength < 2.5) {
      score -= 20;
      reasons.push('short average token length');
    }

    if (!/[.!?。！？]$/.test(trimmed) && tokens.length <= 6 && !['title', 'heading', 'figure_caption', 'table_caption'].includes(type)) {
      score -= 30;
      reasons.push('short fragment without sentence ending');
    }

    if (this.hasAxisOrLegendPattern(trimmed) && !['figure_caption', 'table_caption'].includes(type)) {
      score -= 50;
      reasons.push('axis or legend-like text');
    }

    if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed)) {
      score += 20;
      reasons.push('section number pattern');
    }

    if (/[.!?]$/.test(trimmed)) {
      score += 15;
      reasons.push('complete sentence ending');
    }

    if (/\b(we|our|this|these|however|therefore|because|result|results|method|model|training|performance|dataset|approach)\b/i.test(trimmed)) {
      score += 10;
      reasons.push('academic prose signal');
    }

    if (tokens.length >= 12) {
      score += 12;
      reasons.push('paragraph-length text');
    }

    if (this.hasAbnormalUnicode(trimmed)) {
      score -= 80;
      reasons.push('abnormal unicode ratio');
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      reasons,
    };
  }

  private skipAdmission(type: BlockType, score: number, reason: string): AdmissionResult {
    return {
      type,
      quality: { score, reasons: [reason] },
      translationPolicy: 'skip',
      skipReason: reason,
    };
  }

  private isFigureCaption(text: string): boolean {
    return /^(fig\.?|figure)\s*\d+[\.:]/i.test(text);
  }

  private isTableCaption(text: string): boolean {
    return /^table\s*\d+[\.:]/i.test(text);
  }

  private isReferencesHeading(text: string): boolean {
    return /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|参考文献)\s*[:.]?$/i.test(text.trim());
  }

  private isFormulaLike(text: string): boolean {
    return /[=∑∏√≤≥≈≠]/.test(text) && text.length < 160;
  }

  private isCodeLike(text: string): boolean {
    return /^\s*(function|const|let|var|class|import|def)\b/.test(text) || /[{};]{3,}/.test(text);
  }

  private hasAxisOrLegendPattern(text: string): boolean {
    return /(\bT\s*\d\b|\bI\s*\d\b|#\s*of|^\s*\d*\s*\d?x efficiency|\dX efficiency\s+\dX efficiency|bag of words|contrastive|linear probe|images processed|zero-shot clip performance|error\s*\(%\)|fgvcaircraft|country211|kitti distance|rn50x|\b\d+\s+\d+\s+\d+\b)/i.test(text);
  }

  private hasAbnormalUnicode(text: string): boolean {
    const chars = [...text];
    const abnormal = chars.filter((char) => {
      if (/\s/.test(char)) return false;
      return !/[\p{L}\p{N}\p{P}\p{S}]/u.test(char);
    }).length;
    return abnormal / Math.max(chars.length, 1) > 0.08;
  }

  private normalizeLineKey(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private lineBbox(line: ReadingLine) {
    return {
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
    };
  }

  private emptyBbox() {
    return {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      width: 0,
      height: 0,
    };
  }

  private mergeBbox(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) {
    if (!Number.isFinite(a.x)) return b;
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.width, b.x + b.width);
    const maxY = Math.max(a.y + a.height, b.y + b.height);
    return {
      x: minX,
      y: minY,
      width: Math.max(maxX - minX, 0),
      height: Math.max(maxY - minY, 0),
    };
  }

  private isLikelyTitle(text: string, blockCount: number): boolean {
    if (text.length > 120) return false;
    if (text.length < 3) return false;

    const hasSectionNumber = /^\d+(\.\d+)*\.\s+[A-Z]/.test(text);
    const isAllCaps =
      text.length > 5 &&
      text === text.toUpperCase() &&
      /[A-Z]{3,}/.test(text);
    const isFirstTitle =
      blockCount === 0 &&
      /^[A-Z]/.test(text) &&
      text.split(/\s+/).length >= 4 &&
      !/[.!?]$/.test(text);

    return isFirstTitle || hasSectionNumber || (isAllCaps && text.length <= 80);
  }

  private joinLine(paragraph: string, line: string): string {
    if (paragraph.endsWith('-')) {
      return paragraph.slice(0, -1) + line;
    }
    return paragraph + ' ' + line;
  }

  private cleanupParagraph(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

}
