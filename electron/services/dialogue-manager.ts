import { DialogueHistoryMessage } from './llm-harness';
import { ToolCallingHarness } from './tool-calling-harness';

interface DialogueInput {
  paperTitle: string;
  sectionPath: string[];
  selectedText: string;
  zhBlock: string;
  enBlock: string;
  documentContext?: string;
  question: string;
  chatHistory?: DialogueHistoryMessage[];
}

interface ExternalEvidenceDecision {
  needed: boolean;
  reason: string;
}

export interface DialogueAnswer {
  content: string;
  evidence: {
    usedPaperContext: boolean;
    usedChatHistory: boolean;
    usedWebSearch: boolean;
    searchQueries: string[];
    sources: Array<{
      title: string;
      url: string;
      sourceType: string;
    }>;
  };
  uncertainty: {
    paperHadAnswer: boolean;
    externalEvidenceFound: boolean;
    notes: string[];
  };
}

export class DialogueManager {
  constructor(
    private toolCallingHarness: ToolCallingHarness
  ) {}

  async answer(input: DialogueInput): Promise<DialogueAnswer> {
    const chatHistory = this.getRecentHistory(input.chatHistory || []);
    const externalEvidence = this.detectExternalEvidenceNeed(input);
    const composeInput = {
      ...input,
      chatHistory,
      externalEvidenceNeeded: externalEvidence.needed,
      externalEvidenceAvailable: false,
      externalEvidenceReason: externalEvidence.reason,
    };

    const result = await this.toolCallingHarness.run(composeInput);
    const usedWebSearch = result.toolResults.some((toolResult) => toolResult.toolName === 'web_search');
    const hasWebSearchEvidence = result.sources.length > 0;

    return {
      content: result.content,
      evidence: {
        usedPaperContext: Boolean(input.selectedText || input.zhBlock || input.enBlock || input.documentContext),
        usedChatHistory: chatHistory.length > 0,
        usedWebSearch,
        searchQueries: [],
        sources: result.sources.map((source) => ({
          title: source.title,
          url: source.url,
          sourceType: source.sourceType,
        })),
      },
      uncertainty: {
        paperHadAnswer:
          !externalEvidence.needed || Boolean(input.selectedText || input.zhBlock || input.enBlock || input.documentContext),
        externalEvidenceFound: hasWebSearchEvidence,
        notes:
          externalEvidence.needed && !hasWebSearchEvidence
            ? [
                externalEvidence.reason,
                ...result.toolResults.map((toolResult) => toolResult.error || '').filter(Boolean),
              ]
            : [],
      },
    };
  }

  private getRecentHistory(history: DialogueHistoryMessage[]): DialogueHistoryMessage[] {
    return history
      .filter((message) => message.content.trim().length > 0)
      .slice(-6);
  }

  private detectExternalEvidenceNeed(input: DialogueInput): ExternalEvidenceDecision {
    const question = input.question.trim();
    const selectedText = input.selectedText.trim();
    const contextText = `${input.zhBlock}\n${input.enBlock}`;
    const hasPaperContext = Boolean(
      input.selectedText || input.zhBlock || input.enBlock || input.documentContext
    );

    if (this.hasNoSearchOverride(question)) {
      return {
        needed: false,
        reason: '用户明确要求不使用外部搜索。',
      };
    }

    if (this.isAppUsageQuestion(question)) {
      return {
        needed: false,
        reason: '问题看起来是在询问阅读工具的使用方式，不需要外部证据。',
      };
    }

    if (!hasPaperContext && this.isDocumentLevelQuestion(question)) {
      return {
        needed: true,
        reason: '问题询问整篇论文，但当前没有绑定具体段落或全篇结构证据；V1 不能假装已读取完整论文。',
      };
    }

    if (this.isPaperOnlyQuestion(question)) {
      return {
        needed: false,
        reason: '问题可优先从论文段落解释、翻译或总结。',
      };
    }

    if (this.hasCurrentInfoTrigger(question)) {
      return {
        needed: true,
        reason: '问题询问当前、最新、官网、主页、机构或背景信息，需要外部证据；应优先调用 web_search 工具。',
      };
    }

    if (this.asksForIdentityOrBackground(question)) {
      return {
        needed: true,
        reason: '问题询问人物或专有名词身份背景，需要外部证据；应优先调用 web_search 工具。',
      };
    }

    if (this.looksLikeUnexplainedProperNoun(selectedText, contextText)) {
      return {
        needed: true,
        reason: '选区像未在段落中解释的专有名词，回答身份或背景需要外部证据；应优先调用 web_search 工具。',
      };
    }

    return {
      needed: false,
      reason: '当前问题不需要外部证据。',
    };
  }

  private hasNoSearchOverride(question: string): boolean {
    return /(不要联网|别联网|不要搜索|别搜索|不用搜索|不查网页|不要查网页)/.test(question);
  }

  private isPaperOnlyQuestion(question: string): boolean {
    return /(翻译|解释|说明|什么意思|这段|这句话|总结|概括|改写|润色|为什么|如何理解|translate|explain|summarize|rewrite)/i.test(
      question
    );
  }

  private isDocumentLevelQuestion(question: string): boolean {
    return /(这篇|整篇|全文|论文核心|核心贡献|主要贡献|局限|贡献是什么|总结一下这篇|paper contribution|whole paper)/i.test(
      question
    );
  }

  private isAppUsageQuestion(question: string): boolean {
    return /(这个应用|这个工具|阅读器|导出|PDF|pdf|标注|高亮|加粗|侧边栏|导入|怎么用|如何使用|怎么操作)/i.test(
      question
    );
  }

  private hasCurrentInfoTrigger(question: string): boolean {
    return /(现在|最新|目前|当前|官网|主页|哪家公司|哪个机构|什么机构|什么公司|current|latest|homepage|official|website)/i.test(
      question
    );
  }

  private asksForIdentityOrBackground(question: string): boolean {
    return /(这是谁|是谁|谁是|介绍一下|背景|来历|什么人|作者是谁|profile|background|who is)/i.test(
      question
    );
  }

  private looksLikeUnexplainedProperNoun(selectedText: string, contextText: string): boolean {
    if (!selectedText || selectedText.length > 80) {
      return false;
    }

    const looksLikeName =
      /[A-Z][a-z]+(\s+[A-Z][a-z]+)+/.test(selectedText) ||
      /^[\u4e00-\u9fa5]{2,6}$/.test(selectedText);

    if (!looksLikeName) {
      return false;
    }

    const normalizedContext = contextText.replace(/\s+/g, ' ');
    const mentionsOnlyOnce = normalizedContext.split(selectedText).length <= 2;
    return mentionsOnlyOnce;
  }
}
