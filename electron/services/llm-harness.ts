import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DialogueHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ComposeInput {
  paperTitle: string;
  sectionPath: string[];
  selectedText: string;
  zhBlock: string;
  enBlock: string;
  documentContext?: string;
  question: string;
  chatHistory: DialogueHistoryMessage[];
  externalEvidenceNeeded: boolean;
  externalEvidenceAvailable: boolean;
  externalEvidenceReason: string;
}

export class LlmHarness {
  private readonly llmDir: string;

  constructor() {
    this.llmDir = path.join(app.getAppPath(), 'llm');
  }

  buildComposeMessages(input: ComposeInput): LlmMessage[] {
    const systemPrompt = [
      this.readPolicy('soul.md'),
      this.readPolicy('policies/grounding.md'),
      this.readPolicy('policies/chat-history.md'),
      this.readPolicy('policies/uncertainty.md'),
      this.readPolicy('policies/answer-style.md'),
      this.readPolicy('policies/tool-use.md'),
      this.readPolicy('policies/web-search.md'),
      this.readPolicy('policies/dialogue-cases.md'),
      this.readPolicy('prompts/compose-answer.md'),
    ].join('\n\n---\n\n');

    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: this.buildComposeUserMessage(input),
      },
    ];
  }

  private buildComposeUserMessage(input: ComposeInput): string {
    const hasLocalContext = Boolean(input.selectedText || input.zhBlock || input.enBlock);
    const hasDocumentContext = Boolean(input.documentContext?.trim());
    const historyText =
      input.chatHistory.length > 0
        ? input.chatHistory
            .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
            .join('\n\n')
        : '无';

    return `请基于以下证据回答用户问题。

## 论文信息
标题：${input.paperTitle || '未命名论文'}
章节：${input.sectionPath.length > 0 ? input.sectionPath.join(' > ') : '未知'}

## 选区与段落证据
是否有局部论文上下文：${hasLocalContext ? '是' : '否'}
是否有整篇论文上下文：${hasDocumentContext ? '是' : '否'}

用户选中的文字：
${input.selectedText || '无'}

中文译文段落：
${input.zhBlock || '无'}

英文原文段落：
${input.enBlock || '无'}

## 整篇论文上下文
${input.documentContext || '无'}

如果用户询问整篇论文、核心贡献、主要方法、局限或总结，并且上方提供了整篇论文上下文，请优先使用“整篇论文上下文”回答。不要因为“局部论文上下文”为否，就说当前没有可用论文证据。不要沿用最近对话历史里关于“缺少全篇上下文”的旧判断。

## 最近对话历史
${historyText}

## 已知产品能力
- 用户可以导入 PDF 论文。
- 阅读区展示翻译后的论文内容，并支持高亮、加粗标注。
- 右侧 AI 对话可以基于选区和段落上下文回答问题。
- 阅读页顶栏有 \`导出\` 按钮，可以导出阅读视图 PDF。
- 如果本地配置了搜索服务，AI 可以用结构化外部搜索结果回答论文外问题；未配置时会说明外部证据不可用。

## 外部证据状态
是否需要外部证据：${input.externalEvidenceNeeded ? '是' : '否'}
是否已提供外部证据：${input.externalEvidenceAvailable ? '是' : '否，除非你调用工具并获得结果'}
原因：${input.externalEvidenceReason || '无'}

如果需要外部证据，请优先考虑调用可用工具。若工具不可用或无结果，请不要使用模型常识补全。请说明论文和对话历史能确认什么、不能确认什么。

## 用户问题
${input.question}`;
  }

  private readPolicy(relativePath: string): string {
    const filePath = path.join(this.llmDir, relativePath);
    if (!fs.existsSync(filePath)) {
      return `# Missing Policy\n${relativePath} was not found.`;
    }

    return fs.readFileSync(filePath, 'utf-8').trim();
  }
}
