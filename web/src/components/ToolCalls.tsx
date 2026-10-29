import type { ToolCall } from '../types.ts';

// Pretty-print JSON text when possible, otherwise show it as is.
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ToolCalls({ calls }: { calls: ToolCall[] }) {
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
