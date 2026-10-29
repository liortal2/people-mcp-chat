import { useEffect, useRef } from 'react';
import type { Message } from '../types.ts';
import { MessageBubble } from './MessageBubble.tsx';

export function MessageList({ messages, loading }: { messages: Message[]; loading: boolean }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading]);

  return (
    <main>
      {messages.length === 0 && <p className="hint">Ask about the people directory, e.g. “How many people live in London?”</p>}
      {/* Index keys are safe: the list is append-only, so an index always points at the same message. */}
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
      {loading && <div className="bubble assistant loading">Thinking…</div>}
      <div ref={bottom} />
    </main>
  );
}
