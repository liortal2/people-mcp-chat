import { useState, type FormEvent } from 'react';

// Owns the input text, so typing re-renders only this form, not the message list.
export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (question: string) => void }) {
  const [input, setInput] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || disabled) return;
    onSend(question);
    setInput('');
  }

  return (
    <form onSubmit={submit}>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" autoFocus />
      <button disabled={disabled || !input.trim()}>Send</button>
    </form>
  );
}
