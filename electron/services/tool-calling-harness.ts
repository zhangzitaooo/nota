import {
  DeepSeekAssistantMessage,
  DeepSeekClient,
  DeepSeekMessage,
  DeepSeekToolCall,
} from './deepseek-client';
import { ComposeInput, LlmHarness } from './llm-harness';
import { ToolRegistry } from './tools/tool-registry';
import { SourceEvidence, ToolExecutionResult } from './tools/tool-types';

export interface ToolCallingResult {
  content: string;
  toolResults: ToolExecutionResult[];
  sources: SourceEvidence[];
}

export class ToolCallingHarness {
  private readonly maxToolCalls = 1;

  constructor(
    private llmHarness: LlmHarness,
    private modelClient: DeepSeekClient,
    private toolRegistry: ToolRegistry
  ) {}

  async run(input: ComposeInput): Promise<ToolCallingResult> {
    const tools = this.toolRegistry.getDefinitions();
    const messages = this.llmHarness.buildComposeMessages(input) as DeepSeekMessage[];

    const firstResponse = await this.modelClient.completeWithTools(messages, tools);
    const toolCalls = (firstResponse.tool_calls || []).slice(0, this.maxToolCalls);

    if (toolCalls.length === 0) {
      if (input.externalEvidenceNeeded) {
        const fallbackResponse = await this.modelClient.complete([
          ...messages,
          {
            role: 'user',
            content:
              '系统检查：这个问题需要外部证据，但你没有调用可用工具。请不要使用模型记忆补全外部事实。只能基于论文上下文和最近对话回答；如果证据不足，请明确说明当前无法确认。',
          },
        ]);

        return {
          content: fallbackResponse,
          toolResults: [],
          sources: [],
        };
      }

      return {
        content: firstResponse.content || '',
        toolResults: [],
        sources: [],
      };
    }

    const toolResults = await this.executeToolCalls(toolCalls, input);
    const followUpMessages: DeepSeekMessage[] = [
      ...messages,
      this.toAssistantToolCallMessage(firstResponse),
      ...toolCalls.map((toolCall, index) => ({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResults[index]),
      })),
    ];

    const finalResponse = await this.modelClient.complete(followUpMessages);
    return {
      content: finalResponse,
      toolResults,
      sources: toolResults.flatMap((result) => result.evidence || []),
    };
  }

  private async executeToolCalls(
    toolCalls: DeepSeekToolCall[],
    input: ComposeInput
  ): Promise<ToolExecutionResult[]> {
    return Promise.all(
      toolCalls.map((toolCall) =>
        this.toolRegistry.execute(toolCall.function.name, toolCall.function.arguments, {
          paperTitle: input.paperTitle,
          selectedText: input.selectedText,
          question: input.question,
        })
      )
    );
  }

  private toAssistantToolCallMessage(message: DeepSeekAssistantMessage): DeepSeekMessage {
    return {
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls || [],
    };
  }
}
