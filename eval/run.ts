import { runChat } from '../src/chat/agent.ts';
import { McpUnavailableError } from '../src/chat/mcp-client.ts';
import { openDb } from '../src/mcp/db.ts';
import { QUESTIONS, type Expected } from './questions.ts';

// $ per million tokens [input, output], Anthropic's list prices as of 2026-10-29.
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
};

const numbersIn = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replaceAll(',', '')));

// A name counts as mentioned when its first and last words both appear, so "Barnaby Quiller" matches "Barnaby 'Bee' Quiller".
function mentions(text: string, name: string): boolean {
  const words = name.toLowerCase().split(/\s+/);
  const t = text.toLowerCase();
  return t.includes(words[0]) && t.includes(words.at(-1)!);
}

// What the answer is missing; empty means it passed.
function missingFrom(answer: string, expected: Expected): string[] {
  const found = numbersIn(answer);
  const numbers = (expected.numbers ?? [])
    .filter(({ value, tol = 0 }) => !found.some((n) => Math.abs(n - value) <= tol))
    .map(({ value, tol }) => (tol ? `${value.toFixed(2)} ±${tol}` : String(value)));
  const names = (expected.names ?? []).filter((name) => !mentions(answer, name));
  return [...numbers, ...names];
}

const db = openDb();
const usage = { input_tokens: 0, output_tokens: 0 };
let model = process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5';
let passed = 0;

console.log(`Eval: ${QUESTIONS.length} questions on ${model}\n`);
for (const q of QUESTIONS) {
  const expected = q.expected(db);
  const started = Date.now();
  try {
    const res = await runChat([{ role: 'user', content: q.question }]);
    model = res.model;
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    const missing = missingFrom(res.answer, expected);
    if (!missing.length) passed++;
    const errors = res.toolCalls.filter((c) => c.isError).length;
    const calls = `${res.toolCalls.length} calls${errors ? ` (${errors} error)` : ''}`;
    console.log(`${missing.length ? 'FAIL' : 'pass'}  ${q.id.padEnd(15)} ${calls.padEnd(18)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (missing.length) console.log(`      missing: ${missing.join(', ')}\n      answer:  ${res.answer.replaceAll('\n', ' ')}`);
  } catch (err) {
    if (err instanceof McpUnavailableError) {
      console.error(`${err.message}. Start it first: npm run mcp`);
      process.exit(1);
    }
    console.log(`FAIL  ${q.id.padEnd(15)} error: ${(err as Error).message}`);
  }
}

const price = PRICES[model];
const cost = price ? `$${((usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1e6).toFixed(4)}` : 'n/a (unknown model price)';
console.log(`\n${passed}/${QUESTIONS.length} passed · ${usage.input_tokens} input + ${usage.output_tokens} output tokens · ${cost}`);
process.exitCode = passed === QUESTIONS.length ? 0 : 1;
