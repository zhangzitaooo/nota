export type ToolSourceType = 'official' | 'paper' | 'profile' | 'news' | 'other';

export interface SourceEvidence {
  title: string;
  url: string;
  snippet?: string;
  sourceType: ToolSourceType;
}

export interface ToolExecutionContext {
  paperTitle: string;
  selectedText: string;
  question: string;
}

export interface ToolExecutionResult {
  toolName: string;
  ok: boolean;
  content: string;
  evidence?: SourceEvidence[];
  error?: string;
}

export interface HarnessTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

