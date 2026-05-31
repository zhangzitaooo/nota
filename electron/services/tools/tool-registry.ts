import {
  HarnessTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './tool-types';

export class ToolRegistry {
  private tools = new Map<string, HarnessTool>();

  register(tool: HarnessTool): void {
    this.tools.set(tool.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async execute(
    toolName: string,
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        toolName,
        ok: false,
        content: `工具 ${toolName} 未注册，无法执行。`,
        error: 'Unknown tool.',
      };
    }

    try {
      const args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
      return tool.execute(args, context);
    } catch (error: any) {
      return {
        toolName,
        ok: false,
        content: `工具 ${toolName} 参数无效，无法执行。`,
        error: error.message || 'Invalid tool arguments.',
      };
    }
  }
}

