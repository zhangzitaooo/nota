import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ToolDefinition } from './tools/tool-types';

export interface DeepSeekToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: DeepSeekToolCall[];
}

export interface DeepSeekAssistantMessage {
  role: 'assistant';
  content?: string | null;
  tool_calls?: DeepSeekToolCall[];
}

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl = 'https://api.deepseek.com/v1';

  constructor() {
    // 读取 API key
    this.apiKey = this.loadApiKey();
  }

  private loadApiKey(): string {
    // 1. 环境变量
    if (process.env.DEEPSEEK_API_KEY) {
      return process.env.DEEPSEEK_API_KEY;
    }

    // 2. 项目根目录 .env.local
    const envPath = path.join(app.getAppPath(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/DEEPSEEK_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }

    // 3. 用户目录配置文件
    const configPath = path.join(app.getPath('home'), '.paper-reading-workbench', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.deepseekApiKey) return config.deepseekApiKey;
      } catch {}
    }

    return '';
  }

  async translate(text: string): Promise<string> {
    return this.callApi([
      {
        role: 'system',
        content: `你是一个学术论文翻译助手。请将英文论文段落翻译为准确、自然的中文。
要求：
1. 只输出译文，不输出解释。
2. 保留论文术语、变量名、引用标记和公式编号。
3. 不添加原文没有的信息。
4. 不生成摘要或导读。
5. 中文表达应适合精读，不要过度口语化。`,
      },
      {
        role: 'user',
        content: text,
      },
    ]);
  }

  async chat(context: {
    paperTitle: string;
    sectionPath: string[];
    selectedText: string;
    zhBlock: string;
    enBlock: string;
    question: string;
  }): Promise<string> {
    const hasLocalContext = Boolean(context.zhBlock || context.enBlock || context.selectedText);
    const systemPrompt = `你是一个学术论文阅读助手。用户正在阅读以下论文，并${hasLocalContext ? '针对其中一段内容' : '针对整篇论文'}提问。
请基于提供的论文信息回答问题。

论文标题：${context.paperTitle}
所在章节：${context.sectionPath.join(' > ')}

回答时要：
1. 优先基于提供的段落内容回答
2. 如果问题超出段落范围，可以根据论文标题和你的知识做合理推断
3. 用中文回答
4. 如果涉及英文术语，保留原文`;

    const userMessage = hasLocalContext
      ? `我正在阅读以下段落的中文译文：
---
${context.zhBlock}
---

对应的英文原文：
---
${context.enBlock}
---

我选中的内容是："${context.selectedText}"

我的问题是：${context.question}`
      : `我正在阅读这篇论文，但这次问题没有绑定到某一段选区。

我的问题是：${context.question}`;

    return this.callApi([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);
  }

  async complete(messages: DeepSeekMessage[]): Promise<string> {
    return this.callApi(messages);
  }

  async completeWithTools(
    messages: DeepSeekMessage[],
    tools: ToolDefinition[]
  ): Promise<DeepSeekAssistantMessage> {
    return this.callChatCompletion(messages, tools);
  }

  private async callApi(messages: DeepSeekMessage[]): Promise<string> {
    const message = await this.callChatCompletion(messages);
    return message.content || '';
  }

  private async callChatCompletion(
    messages: DeepSeekMessage[],
    tools?: ToolDefinition[]
  ): Promise<DeepSeekAssistantMessage> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key 未配置。请在 .env.local 中设置 DEEPSEEK_API_KEY。');
    }

    const body: Record<string, unknown> = {
      model: 'deepseek-v4-pro',
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message || { role: 'assistant', content: '' };
  }
}
