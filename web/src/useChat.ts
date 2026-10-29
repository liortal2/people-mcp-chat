import { useState } from 'react';
import { sendChat } from './api.ts';
import type { Message } from './types.ts';

// Owns the conversation: the messages so far, whether a request is in flight, and send().
export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function send(question: string) {
    if (loading) return;
    const next: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setLoading(true);
    try {
      // History is sent as plain text only: no tool calls or errors, so each answer uses fresh tool results.
      const history = next.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const { answer, toolCalls } = await sendChat(history);
      setMessages([...next, { role: 'assistant', content: answer, toolCalls }]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: (err as Error).message, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return { messages, loading, send };
}
