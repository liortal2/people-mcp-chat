import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ToolCall {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  ms: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  error?: boolean;
}

// Pretty-print JSON text when possible, otherwise show it as is.
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function ToolCalls({ calls }: { calls: ToolCall[] }) {
  return (
    <details className="tools">
      <summary>Tool calls ({calls.length})</summary>
      {calls.map((c, i) => (
        <div key={i} className={c.isError ? 'call error' : 'call'}>
          <div className="call-head">
            <strong>{c.name}</strong> <span>{c.ms} ms{c.isError ? ' · error' : ''}</span>
          </div>
          <pre>{JSON.stringify(c.input, null, 2)}</pre>
          <pre className="output">{pretty(c.output)}</pre>
        </div>
      ))}
    </details>
  );
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    const next: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      // History is sent as plain text only: no tool calls or errors, so each answer uses fresh tool results.
      const history = next.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setMessages([...next, { role: 'assistant', content: data.answer, toolCalls: data.toolCalls }]);
    } catch (err) {
      const reason = err instanceof TypeError ? 'Could not reach the chat server.' : (err as Error).message;
      setMessages([...next, { role: 'assistant', content: reason, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>People Chat</header>
      <main>
        {messages.length === 0 && <p className="hint">Ask about the people directory, e.g. “How many people live in London?”</p>}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
            {m.role === 'user' ? m.content : <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>}
            {m.toolCalls && m.toolCalls.length > 0 && <ToolCalls calls={m.toolCalls} />}
          </div>
        ))}
        {loading && <div className="bubble assistant loading">Thinking…</div>}
        <div ref={bottom} />
      </main>
      <form onSubmit={send}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" autoFocus />
        <button disabled={loading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
