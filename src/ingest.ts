import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

const CSV_PATH = 'data/people-list-export.csv';
const DB_PATH = 'data/people.db';

type CsvRow = Record<string, string>;

// Dates in the export are DD/MM/YYYY. new Date() would read them as MM/DD, so parse explicitly.
export function parseDmy(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  const valid = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  if (!valid) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// "GBP £" -> "GBP"
export function normalizeCurrency(value: string): string | null {
  const code = value.trim().slice(0, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function normalizePeriod(value: string): 'yearly' | 'monthly' | 'hourly' | null {
  const v = value.trim().toLowerCase();
  return v === 'yearly' || v === 'monthly' || v === 'hourly' ? v : null;
}

const emptyToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

const SCHEMA = `
CREATE TABLE people (
  id              INTEGER PRIMARY KEY,
  full_name       TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  work_email      TEXT NOT NULL UNIQUE,
  work_status     TEXT NOT NULL,
  job             TEXT,
  team            TEXT,
  reports_to      TEXT,
  office          TEXT,
  city            TEXT,
  country         TEXT,
  start_date      TEXT,  -- ISO YYYY-MM-DD
  date_of_birth   TEXT,  -- ISO YYYY-MM-DD
  gender          TEXT,
  contract_type   TEXT,
  salary_amount   REAL,
  salary_currency TEXT,  -- GBP | USD | ILS
  salary_period   TEXT   -- yearly | monthly | hourly
);

-- Derived fields live here so they are computed at query time and never go stale.
CREATE VIEW people_v AS
SELECT
  p.*,
  CASE WHEN date_of_birth IS NULL THEN NULL ELSE
    CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', date_of_birth) AS INTEGER)
    - (strftime('%m-%d', 'now') < strftime('%m-%d', date_of_birth))
  END AS age,
  CASE WHEN start_date IS NULL THEN NULL ELSE
    ROUND((julianday('now') - julianday(start_date)) / 365.25, 1)
  END AS tenure_years
FROM people p;
`;

export interface IngestResult {
  rows: number;
  warnings: string[];
}

// Recreates the schema and loads all rows in one transaction.
export function ingest(db: DatabaseSync, csvText: string): IngestResult {
  const records: CsvRow[] = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });
  const warnings: string[] = [];

  db.exec('DROP VIEW IF EXISTS people_v; DROP TABLE IF EXISTS people;');
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA);
    const insert = db.prepare(`
      INSERT INTO people (full_name, first_name, last_name, work_email, work_status, job, team, reports_to,
        office, city, country, start_date, date_of_birth, gender, contract_type,
        salary_amount, salary_currency, salary_period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const r of records) {
      const text = (col: string) => emptyToNull(r[col] ?? '');
      // Empty -> NULL, invalid -> stop the whole ingest (corrupt data, not just missing).
      const date = (col: string) => {
        const raw = text(col);
        if (raw === null) return null;
        const iso = parseDmy(raw);
        if (!iso) throw new Error(`${r['Full Name']}: bad ${col} "${raw}"`);
        return iso;
      };

      const missing = ['Job', 'Team', 'Start Date', 'Date of Birth', 'Salary Amount'].filter((col) => text(col) === null);
      if (missing.length) warnings.push(`${r['Full Name']}: missing fields (${missing.join(', ')})`);

      const amount = text('Salary Amount');
      insert.run(
        r['Full Name'],
        text('First Name'),
        text('Last Name'),
        r['Work Email'],
        r['Work Status'],
        text('Job'),
        text('Team'),
        text('Reports To'),
        text('Office'),
        text('City'),
        text('Country'),
        date('Start Date'),
        date('Date of Birth'),
        text('Gender'),
        text('Contract Type'),
        amount === null ? null : Number(amount),
        normalizeCurrency(r['Salary Currency'] ?? ''),
        normalizePeriod(r['Salary Type'] ?? ''),
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { rows: records.length, warnings };
}

if (import.meta.main) {
  mkdirSync('data', { recursive: true });
  rmSync(DB_PATH, { force: true });
  const db = new DatabaseSync(DB_PATH);
  const { rows, warnings } = ingest(db, readFileSync(CSV_PATH, 'utf8'));
  db.close();
  console.log(`Ingested ${rows} rows into ${DB_PATH}, ${warnings.length} warning(s)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}
