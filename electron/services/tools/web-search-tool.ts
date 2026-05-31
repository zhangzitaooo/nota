import {
  HarnessTool,
  SourceEvidence,
  ToolExecutionContext,
  ToolExecutionResult,
} from './tool-types';

export interface WebSearchProvider {
  isEnabled(): boolean;
  search(query: string): Promise<SourceEvidence[]>;
}

export class DisabledWebSearchProvider implements WebSearchProvider {
  isEnabled(): boolean {
    return false;
  }

  async search(): Promise<SourceEvidence[]> {
    return [];
  }
}

interface WebSearchArgs {
  query?: string;
}

export class WebSearchTool implements HarnessTool {
  readonly name = 'web_search';

  readonly description =
    'Search the web for external facts not contained in the paper context. Use this for author identity, background, official websites, current status, latest work, repositories, datasets, or other proper nouns that the paper does not explain.';

  readonly parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'A concise web search query. Include the selected term and paper title when useful. Do not include full paper text.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  };

  constructor(private provider: WebSearchProvider = new DisabledWebSearchProvider()) {}

  async execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const query = this.normalizeQuery(args, context);

    if (!this.provider.isEnabled()) {
      return {
        toolName: this.name,
        ok: false,
        content:
          'web_search 工具已被调用，但当前没有可用的搜索 provider。请只基于论文上下文和最近对话回答；如果需要外部事实，请明确说明当前无法确认。',
        error: 'Web search provider is disabled.',
      };
    }

    try {
      const evidence = await this.provider.search(query);
      if (evidence.length === 0) {
        return {
          toolName: this.name,
          ok: false,
          content: `web_search 没有找到可用结果。查询：${query}`,
          evidence: [],
          error: 'No search results.',
        };
      }

      return {
        toolName: this.name,
        ok: true,
        content: this.formatEvidence(query, evidence),
        evidence,
      };
    } catch (error: any) {
      return {
        toolName: this.name,
        ok: false,
        content: `web_search 执行失败。查询：${query}`,
        error: error.message || 'Web search failed.',
      };
    }
  }

  private normalizeQuery(args: unknown, context: ToolExecutionContext): string {
    const maybeArgs = args as WebSearchArgs;
    const query = typeof maybeArgs.query === 'string' ? maybeArgs.query.trim() : '';
    if (query) {
      return query.slice(0, 400);
    }

    return [context.selectedText, context.paperTitle, context.question]
      .filter(Boolean)
      .join(' ')
      .slice(0, 400);
  }

  private formatEvidence(query: string, evidence: SourceEvidence[]): string {
    const results = evidence
      .map(
        (source, index) =>
          `${index + 1}. [${source.sourceType}] ${source.title}\nURL: ${source.url}\n摘要: ${
            source.snippet || '无'
          }`
      )
      .join('\n\n');

    return `web_search 查询：${query}\n\n结果：\n${results}`;
  }
}
