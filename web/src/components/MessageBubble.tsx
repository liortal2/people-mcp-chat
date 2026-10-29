import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types.ts';
import { ToolCalls } from './ToolCalls.tsx';

const remarkPlugins = [remarkGfm];

// memo: a message never changes once added, so an existing bubble skips re-rendering (and re-parsing its Markdown)
// whenever the list changes.
export const MessageBubble = memo(function MessageBubble({ message: m }: { message: Message }) {
  return (
    <div className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
      {m.role === 'user' ? m.content : <Markdown remarkPlugins={remarkPlugins}>{m.content}</Markdown>}
      {m.toolCalls && m.toolCalls.length > 0 && <ToolCalls calls={m.toolCalls} />}
    </div>
  );
});
