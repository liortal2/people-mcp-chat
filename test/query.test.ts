import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ingest } from '../src/ingest.ts';
import { QueryInput, compileQuery, runQuery } from '../src/mcp/query.ts';

const db = new DatabaseSync(':memory:');
ingest(db, readFileSync('data/people-list-export.csv', 'utf8'));

const parse = (input: unknown) => QueryInput.parse(input);
const run = (input: unknown) => runQuery(db, parse(input)) as { rows: Record<string, unknown>[]; truncated?: boolean; sql: string; params: unknown[]; notes?: string[] };

test('values are bound as params, never inlined in SQL', () => {
  const q = compileQuery(parse({ filters: [{ field: 'city', op: 'eq', value: 'London' }] }));
  assert.match(q.sql, /p\.city = \? COLLATE NOCASE/);
  assert.ok(!q.sql.includes('London'));
  assert.equal(q.params[0], 'London');
});

test('an injection string stays a param and matches nothing', () => {
  const evil = "x'; DROP TABLE people; --";
  const q = compileQuery(parse({ filters: [{ field: 'team', op: 'eq', value: evil }] }));
  assert.ok(!q.sql.includes('DROP'));
  assert.equal(q.params[0], evil);
  assert.equal(run({ filters: [{ field: 'team', op: 'eq', value: evil }] }).rows.length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n, 107);
});

test('unknown field is rejected', () => {
  assert.throws(() => parse({ filters: [{ field: 'work_email', op: 'eq', value: 'x' }] }));
  assert.throws(() => parse({ group_by: 'password' }));
});

test('unknown keys are rejected instead of silently dropped', () => {
  assert.throws(() => parse({ fn: 'count', filters: [] }), /fn/);
  assert.throws(() => parse({ aggregate: { fn: 'count', fied: 'age' } }));
  assert.throws(() => parse({ filters: [{ field: 'city', op: 'eq', value: 'x', extra: 1 }] }));
});

test('avg on a text field is rejected with a clear error', () => {
  assert.throws(() => compileQuery(parse({ aggregate: { fn: 'avg', field: 'team' } })), /avg needs a number field/);
});

test('operators are checked against field types', () => {
  assert.throws(() => compileQuery(parse({ filters: [{ field: 'team', op: 'gt', value: 'a' }] })), /does not apply to text/);
  assert.throws(() => compileQuery(parse({ filters: [{ field: 'age', op: 'contains', value: '4' }] })), /only applies to text/);
  assert.throws(() => compileQuery(parse({ filters: [{ field: 'age', op: 'gt', value: 'old' }] })), /numeric/);
});

test('count with a filter: London = 55 (case-insensitive)', () => {
  const r = run({ filters: [{ field: 'city', op: 'eq', value: 'london' }], aggregate: { fn: 'count' } });
  assert.equal(r.rows[0].value, 55);
});

test('avg age is 2-decimal rounded and ignores the pending arrival', () => {
  const r = run({ aggregate: { fn: 'avg', field: 'age' } });
  assert.ok(Math.abs(Number(r.rows[0].value) - 36.42) < 0.5);
});

test('group_by without aggregate counts per group, sorted desc; the pending arrival is a null group', () => {
  const r = run({ group_by: 'office' });
  assert.deepEqual(r.rows.map((x) => x.value), [55, 27, 24, 1]);
  assert.equal(r.rows[3].office, null);
});

test('salary averages are auto-grouped by currency and period', () => {
  const r = run({ aggregate: { fn: 'avg', field: 'salary_amount' } });
  assert.ok(r.rows.length > 1);
  assert.ok(r.rows.every((x) => x.salary_currency && x.salary_period));
  assert.ok(r.notes?.[0].includes('not comparable'));
  const nyc = run({ filters: [{ field: 'city', op: 'eq', value: 'New York' }], aggregate: { fn: 'avg', field: 'salary_amount' } });
  assert.deepEqual(nyc.rows.map((x) => x.value), [76240.74]);
});

test('limit is capped and truncation is reported', () => {
  assert.throws(() => parse({ limit: 51 }));
  const r = run({ limit: 5 });
  assert.equal(r.rows.length, 5);
  assert.equal(r.truncated, true);
  assert.equal(run({ filters: [{ field: 'reports_to', op: 'eq', value: 'Orly Naveh' }] }).truncated, false);
});

test('date filters take DD/MM/YYYY and dates are returned as DD/MM/YYYY', () => {
  const r = run({ filters: [{ field: 'start_date', op: 'lt', value: '01/01/2018' }], sort: { field: 'start_date', direction: 'asc' } });
  assert.equal(r.rows[0].full_name, 'Gideon Sterling');
  assert.equal(r.rows[0].start_date, '04/09/2017');
  assert.throws(() => compileQuery(parse({ filters: [{ field: 'start_date', op: 'lt', value: '2018-01-01' }] })), /DD\/MM\/YYYY/);
});

test('date aggregate groups are ordered by date, not by DD/MM text', () => {
  const rows = run({ aggregate: { fn: 'min', field: 'start_date' }, group_by: 'office' }).rows;
  assert.deepEqual(rows.slice(0, 3).map((r) => r.value), ['05/05/2023', '09/11/2019', '04/09/2017']);
});

test('min of a date field is formatted DD/MM/YYYY', () => {
  assert.equal(run({ aggregate: { fn: 'min', field: 'start_date' } }).rows[0].value, '04/09/2017');
});

test('brief questions: Orly Naveh has 7 reports, 30 people are over 40', () => {
  assert.equal(run({ filters: [{ field: 'reports_to', op: 'eq', value: 'Orly Naveh' }] }).rows.length, 7);
  assert.equal(run({ filters: [{ field: 'age', op: 'gt', value: 40 }], aggregate: { fn: 'count' } }).rows[0].value, 30);
});

test('list rows never include email or date of birth', () => {
  const keys = Object.keys(run({ limit: 1 }).rows[0]);
  assert.ok(!keys.includes('work_email') && !keys.includes('date_of_birth'));
});
