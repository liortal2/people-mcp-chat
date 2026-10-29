import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parseDmy } from '../ingest.ts';
import { FIELDS, FIELD_BY_NAME, FIELD_NAMES, type Field } from './fields.ts';

const MAX_LIMIT = 50;
const MAX_GROUPS = 50;

export const QueryInput = z.object({
  filters: z
    .array(
      z.object({
        field: z.enum(FIELD_NAMES),
        op: z.enum(['eq', 'contains', 'gt', 'lt']).describe('eq: equals (text is case-insensitive). contains: text substring. gt/lt: numbers and dates only'),
        value: z.union([z.string(), z.number()]).describe('Dates as DD/MM/YYYY'),
      }).strict(),
    )
    .default([])
    .describe('Conditions, all must match (AND)'),
  aggregate: z
    .object({
      fn: z.enum(['count', 'avg', 'min', 'max']),
      field: z.enum(FIELD_NAMES).optional().describe('Required for avg/min/max. avg needs a number field. Omit for count'),
    })
    .strict()
    .optional()
    .describe('Return one computed value instead of rows'),
  group_by: z.enum(FIELD_NAMES).optional().describe('With aggregate: one value per group (categorical fields only). Without aggregate, counts per group'),
  sort: z.object({ field: z.enum(FIELD_NAMES), direction: z.enum(['asc', 'desc']).default('asc') }).strict().optional().describe('Row mode only'),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(20).describe('Row mode only'),
// Strict: a misplaced key (e.g. `fn` outside `aggregate`) is an error, not silently dropped into a different query.
}).strict();
export type QueryInputT = z.infer<typeof QueryInput>;
type Filter = QueryInputT['filters'][number];
type Aggregate = NonNullable<QueryInputT['aggregate']>;
type Params = (string | number)[];

export interface CompiledQuery {
  sql: string;
  params: Params;
  mode: 'rows' | 'aggregate';
  limit: number;
  notes: string[];
}

function field(name: string): Field {
  const f = FIELD_BY_NAME.get(name);
  if (!f) throw new Error(`Unknown field "${name}". Call describe_people_data to see the available fields.`);
  return f;
}

// Dates are stored as ISO, shown as DD/MM/YYYY.
const display = (f: Field) => (f.type === 'date' ? `strftime('%d/%m/%Y', p.${f.name})` : `p.${f.name}`);

const whereSql = (where: string[]) => (where.length ? ` WHERE ${where.join(' AND ')}` : '');

// One filter -> one SQL condition. The value is pushed to params; the SQL only gets a `?`.
function compileFilter(f: Filter, params: Params): string {
  const def = field(f.field);
  return def.type === 'text' ? textCondition(def, f, params) : comparisonCondition(def, f, params);
}

// eq is case-insensitive; contains is a substring match with the LIKE wildcards % and _ escaped.
function textCondition(def: Field, f: Filter, params: Params): string {
  if (f.op === 'gt' || f.op === 'lt') throw new Error(`Operator "${f.op}" does not apply to text field "${def.name}". Use eq or contains.`);
  const text = String(f.value);
  if (f.op === 'eq') {
    params.push(text);
    return `p.${def.name} = ? COLLATE NOCASE`;
  }
  params.push(`%${text.replace(/[\\%_]/g, '\\$&')}%`);
  return `p.${def.name} LIKE ? ESCAPE '\\'`;
}

// Numbers and dates: =, > or <. Dates come in as DD/MM/YYYY and are compared as ISO.
function comparisonCondition(def: Field, f: Filter, params: Params): string {
  if (f.op === 'contains') throw new Error(`Operator "contains" only applies to text fields, "${def.name}" is ${def.type}.`);
  const sqlOp = { eq: '=', gt: '>', lt: '<' }[f.op];
  if (def.type === 'number') {
    const n = Number(f.value);
    if (f.value === '' || Number.isNaN(n)) throw new Error(`Field "${def.name}" needs a numeric value, got "${f.value}".`);
    params.push(n);
  } else {
    const iso = parseDmy(String(f.value));
    if (!iso) throw new Error(`Field "${def.name}" needs a date as DD/MM/YYYY, got "${f.value}".`);
    params.push(iso);
  }
  return `p.${def.name} ${sqlOp} ?`;
}

// Pure: validated input in, parameterised SQL out. Field names come only from the allowlist, values only as params.
export function compileQuery(input: QueryInputT): CompiledQuery {
  const params: Params = [];
  const where = input.filters.map((f) => compileFilter(f, params));
  // group_by without an aggregate means "count per group".
  const aggregate = input.aggregate ?? (input.group_by ? { fn: 'count' as const } : undefined);
  return aggregate ? compileAggregate(input, aggregate, where, params) : compileRows(input, where, params);
}

// Row mode: the allowlisted columns of the matching people.
function compileRows(input: QueryInputT, where: string[], params: Params): CompiledQuery {
  const cols = FIELDS.map((f) => `${display(f)} AS ${f.name}`).join(', ');
  const sort = input.sort ? `p.${field(input.sort.field).name} ${input.sort.direction === 'desc' ? 'DESC' : 'ASC'}, ` : '';
  const sql = `SELECT ${cols} FROM people_v p` + whereSql(where) + ` ORDER BY ${sort}p.full_name LIMIT ?`;
  // One extra row tells us whether the result was truncated.
  return { sql, params: [...params, input.limit + 1], mode: 'rows', limit: input.limit, notes: [] };
}

// Aggregate mode: one computed value, or one per group.
function compileAggregate(input: QueryInputT, aggregate: Aggregate, where: string[], params: Params): CompiledQuery {
  const target = aggregate.field ? field(aggregate.field) : undefined;
  const aggExpr = aggregateExpr(aggregate.fn, target);
  // Groups are ordered by aggExpr (ISO for dates, so chronological); only the shown value is DD/MM/YYYY.
  const valueExpr = aggregate.fn !== 'count' && target?.type === 'date' ? `strftime('%d/%m/%Y', ${aggExpr})` : aggExpr;

  const groups = input.group_by ? [groupField(input.group_by)] : [];
  const conditions = [...where];
  const notes: string[] = [];
  // Amounts in different currencies/periods must never be mixed in one number.
  if (target?.name === 'salary_amount' && aggregate.fn !== 'count') {
    for (const name of ['salary_currency', 'salary_period']) if (!groups.some((g) => g.name === name)) groups.push(field(name));
    conditions.push('p.salary_amount IS NOT NULL');
    notes.push('salary_amount is grouped by salary_currency and salary_period: amounts in different currencies or periods are not comparable.');
  }

  const select = [...groups.map((g) => `p.${g.name} AS ${g.name}`), `${valueExpr} AS value`].join(', ');
  const sql =
    `SELECT ${select} FROM people_v p` +
    whereSql(conditions) +
    (groups.length ? ` GROUP BY ${groups.map((g) => `p.${g.name}`).join(', ')} ORDER BY ${aggExpr} DESC, 1` : '') +
    ` LIMIT ?`;
  return { sql, params: [...params, MAX_GROUPS], mode: 'aggregate', limit: MAX_GROUPS, notes };
}

// The SQL for count/avg/min/max, after checking that the function suits the field's type.
function aggregateExpr(fn: Aggregate['fn'], target: Field | undefined): string {
  if (fn === 'count') return target ? `COUNT(p.${target.name})` : 'COUNT(*)';
  if (!target) throw new Error(`Aggregate "${fn}" needs a field.`);
  if (fn === 'avg' && target.type !== 'number') throw new Error(`Cannot compute avg of ${target.type} field "${target.name}". avg needs a number field.`);
  if (target.type === 'text') throw new Error(`Cannot compute ${fn} of text field "${target.name}". Use a number or date field.`);
  return fn === 'avg' ? `ROUND(AVG(p.${target.name}), 2)` : `${fn.toUpperCase()}(p.${target.name})`;
}

// Only categorical fields can be grouped: grouping by e.g. full_name would give one group per person.
function groupField(name: string): Field {
  const g = field(name);
  if (!g.categorical) throw new Error(`Cannot group by "${g.name}". Group by one of: ${FIELDS.filter((f) => f.categorical).map((f) => f.name).join(', ')}.`);
  return g;
}

export function runQuery(db: DatabaseSync, input: QueryInputT) {
  const q = compileQuery(input);
  const rows = db.prepare(q.sql).all(...q.params).map((r) => ({ ...r }));
  const result: Record<string, unknown> = { mode: q.mode };
  if (q.mode === 'rows') {
    result.truncated = rows.length > q.limit;
    result.rows = rows.slice(0, q.limit);
    result.row_count = (result.rows as unknown[]).length;
  } else {
    result.rows = rows;
  }
  if (q.notes.length) result.notes = q.notes;
  result.sql = q.sql;
  result.params = q.params;
  return result;
}
