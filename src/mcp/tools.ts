import type { DatabaseSync } from 'node:sqlite';
import type { McpServer } from '@modelcontextprotocol/server';
import { FIELDS } from './fields.ts';

const MAX_DISTINCT = 25;

const NOTES = [
  'Dates are shown as DD/MM/YYYY.',
  'city, country and office are one-to-one: London / United Kingdom / "London HQ & Flagship", etc. "Place" can mean any of them.',
  'One record has work_status "pending_arrival": a hire who has not started, with most fields empty.',
  'Salaries are in mixed currencies and periods (yearly, monthly, hourly). Never add or average across currencies.',
];

export function describePeopleData(db: DatabaseSync) {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM people_v').get() as { n: number }).n;

  const fields = FIELDS.map((f) => {
    const out: Record<string, unknown> = { name: f.name, type: f.type, description: f.description };
    // f.name comes from the FIELDS constant, never from user input, so interpolating it is safe.
    if (f.categorical) {
      const rows = db
        .prepare(`SELECT ${f.name} AS value, COUNT(*) AS n FROM people_v WHERE ${f.name} IS NOT NULL GROUP BY 1 ORDER BY n DESC, value`)
        .all() as { value: string; n: number }[];
      if (rows.length <= MAX_DISTINCT) out.values = Object.fromEntries(rows.map((r) => [r.value, r.n]));
      else out.distinct_values = rows.length;
    } else if (f.type === 'number') {
      out.range = db.prepare(`SELECT MIN(${f.name}) AS min, MAX(${f.name}) AS max FROM people_v`).get();
    } else if (f.type === 'date') {
      out.range = db
        .prepare(`SELECT strftime('%d/%m/%Y', MIN(${f.name})) AS min, strftime('%d/%m/%Y', MAX(${f.name})) AS max FROM people_v`)
        .get();
    }
    return out;
  });

  return { total_records: total, fields, notes: NOTES };
}

export function registerTools(server: McpServer, db: DatabaseSync) {
  server.registerTool(
    'describe_people_data',
    {
      description:
        'Describes the company people directory: every queryable field with its type, meaning, and (for categorical fields) the possible values with counts. Call this first when unsure how a term in the question maps to the data.',
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(describePeopleData(db), null, 2) }] }),
  );
}
