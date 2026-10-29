export interface ToolCall {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  ms: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  error?: boolean;
}
