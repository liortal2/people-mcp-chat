import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/client';
import { withMcp } from './mcp-client.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

const MAX_STEPS = 8;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  ms: number;
}

export interface ChatResult {
  answer: string;
  toolCalls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// MCP tool definitions in Anthropic's format (only the schema key is renamed).
async function toolsForClaude(mcp: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await mcp.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

// The text of a response, without its tool calls or thinking.
function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Never throws: a failed call becomes an error result, so one failure can't sink the others in Promise.all.
async function callTool(mcp: Client, name: string, input: unknown): Promise<ToolCall> {
  const started = Date.now();
  try {
    const res = await mcp.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> });
    const output = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
    return { name, input, output, isError: res.isError === true, ms: Date.now() - started };
  } catch (err) {
    return { name, input, output: err instanceof Error ? err.message : String(err), isError: true, ms: Date.now() - started };
  }
}

// Runs every tool Claude asked for, in parallel. Returns the calls (for the UI) and the matching tool_result blocks (for Claude).
async function runToolUses(mcp: Client, content: Anthropic.ContentBlock[]) {
  const uses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const calls = await Promise.all(uses.map((u) => callTool(mcp, u.name, u.input)));
  const results: Anthropic.ToolResultBlockParam[] = uses.map((u, i) => ({
    type: 'tool_result',
    tool_use_id: u.id,
    content: calls[i].output,
    is_error: calls[i].isError,
  }));
  return { calls, results };
}

// The tool-use loop: ask Claude, run the tools it requests against the MCP server, feed results back, repeat.
export async function runChat(history: ChatMessage[]): Promise<ChatResult> {
  const model = process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5';
  const mcpUrl = process.env.MCP_URL ?? 'http://localhost:3000/mcp';

  return withMcp(mcpUrl, async (mcp) => {
    // The chat backend knows nothing about "people": it forwards whatever tools the MCP server lists.
    const tools = await toolsForClaude(mcp);
    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    const toolCalls: ToolCall[] = [];
    const usage = { input_tokens: 0, output_tokens: 0 };
    const done = (answer: string): ChatResult => ({ answer, toolCalls, usage, model });

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: { effort: 'low' },
        tools,
        messages,
      });
      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;

      switch (response.stop_reason) {
        case 'end_turn':
          return done(textOf(response));
        case 'max_tokens':
          return done(`${textOf(response)}\n\n(The answer was cut off because it hit the length limit.)`.trim());
        case 'refusal':
          return done("Sorry, I can't help with that request.");
        case 'tool_use': {
          // Keep the whole assistant turn (including any thinking blocks) for the next request.
          messages.push({ role: 'assistant', content: response.content });
          const { calls, results } = await runToolUses(mcp, response.content);
          toolCalls.push(...calls);
          // All results go back together in one user message.
          messages.push({ role: 'user', content: results });
          break;
        }
        default:
          return done(textOf(response) || `Stopped unexpectedly (${response.stop_reason}).`);
      }
    }
    return done("I couldn't finish answering within the allowed number of tool calls. Please try a simpler question.");
  });
}
