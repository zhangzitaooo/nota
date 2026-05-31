import { DeepSeekClient } from './deepseek-client';

interface BlockInput {
  id: string;
  en: string;
  type: string;
  sectionPath: string[];
  page: number;
  order: number;
  quality?: {
    score: number;
    reasons: string[];
  };
  translationPolicy?: 'translate' | 'keep_original' | 'skip' | 'asset';
  skipReason?: string;
  assetPath?: string;
}

interface BlockOutput extends BlockInput {
  zh: string;
  status: 'pending' | 'translating' | 'done' | 'failed';
  error?: string;
}

export class Translator {
  private client: DeepSeekClient;

  constructor(client: DeepSeekClient) {
    this.client = client;
  }

  async translateAll(
    blocks: BlockInput[],
    onProgress: (blockId: string, status: string, zh?: string, error?: string) => void
  ): Promise<BlockOutput[]> {
    const results: BlockOutput[] = blocks.map((b) => ({
      ...b,
      zh: '',
      status: 'pending' as const,
    }));

    let inReferences = false;
    for (let i = 0; i < results.length; i++) {
      const block = results[i];
      if (this.isReferencesHeading(block.en) || this.isReferenceSectionBlock(block)) {
        inReferences = true;
      }

      if (inReferences || !this.shouldTranslate(block)) {
        if (inReferences) {
          block.type = block.type === 'heading' && this.isReferencesHeading(block.en)
            ? block.type
            : 'reference';
          block.translationPolicy = 'skip';
          block.skipReason = 'references section';
        }
        block.zh = block.en;
        block.status = 'done';
        onProgress(block.id, 'done', block.en);
        continue;
      }

      try {
        onProgress(block.id, 'translating');
        block.zh = await this.client.translate(block.en);
        block.status = 'done';
        onProgress(block.id, 'done', block.zh);
      } catch (error: any) {
        block.status = 'failed';
        block.error = error.message || '翻译失败';
        onProgress(block.id, 'failed', undefined, block.error);
      }

      // 在每段翻译之间加一点延迟，避免 API 限流
      if (i < results.length - 1) {
        await this.delay(200);
      }
    }

    return results;
  }

  async translateBlock(block: BlockInput): Promise<BlockOutput> {
    if (this.isReferencesHeading(block.en) || this.isReferenceSectionBlock(block) || !this.shouldTranslate(block)) {
      return { ...block, zh: block.en, status: 'done' };
    }

    try {
      const zh = await this.client.translate(block.en);
      return { ...block, zh, status: 'done' };
    } catch (error: any) {
      return {
        ...block,
        zh: '',
        status: 'failed',
        error: error.message || '翻译失败',
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldTranslate(block: BlockInput): boolean {
    if (this.isReferenceSectionBlock(block) || this.isReferencesHeading(block.en)) {
      return false;
    }

    if (block.translationPolicy && block.translationPolicy !== 'translate') {
      return false;
    }

    if (block.quality && block.quality.score < 60) {
      return false;
    }

    if (block.en.trim().length < 3) {
      return false;
    }

    return ![
      'reference',
      'formula',
      'code',
      'footnote',
      'page_header',
      'page_footer',
      'figure_asset',
      'table_asset',
      'figure_body',
      'table_body',
      'visual_noise',
    ].includes(block.type);
  }

  private isReferenceSectionBlock(block: BlockInput): boolean {
    return block.type === 'reference' || this.isReferencesHeading(block.sectionPath?.[0] || '');
  }

  private isReferencesHeading(text: string): boolean {
    return /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|参考文献)\s*[:.]?$/i.test(text.trim());
  }
}
