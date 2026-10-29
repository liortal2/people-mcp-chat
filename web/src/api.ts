import type { Message, ToolCall } from './types.ts';

export interface ChatReply {
  answer: string;
  toolCalls: ToolCall[];
}

// POST the history to the chat server. Throws an Error whose message is ready to show to the user.
export async function sendChat(history: Pick<Message, 'role' | 'content'>[]): Promise<ChatReply> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
  } catch {
    throw new Error('Could not reach the chat server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
