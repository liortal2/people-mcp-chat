import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ingest, parseDmy, normalizeCurrency, normalizePeriod } from '../src/ingest.ts';

test('parseDmy reads DD/MM/YYYY, not MM/DD', () => {
  assert.equal(parseDmy('28/01/1977'), '1977-01-28');
  assert.equal(parseDmy('03/06/2023'), '2023-06-03');
});

test('parseDmy rejects invalid and empty dates', () => {
  assert.equal(parseDmy('31/02/2020'), null);
  assert.equal(parseDmy('2020-01-01'), null);
  assert.equal(parseDmy(''), null);
});

test('currency and period are normalised', () => {
  assert.equal(normalizeCurrency('GBP £'), 'GBP');
  assert.equal(normalizeCurrency('ILS ₪'), 'ILS');
  assert.equal(normalizeCurrency(''), null);
  assert.equal(normalizePeriod('Yearly'), 'yearly');
  assert.equal(normalizePeriod(''), null);
});

test('ingest loads the CSV into an in-memory DB', () => {
  const db = new DatabaseSync(':memory:');
  const { rows, warnings } = ingest(db, readFileSync('data/people-list-export.csv', 'utf8'));
  assert.equal(rows, 107);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Oryan Moshe/);

  const london = db.prepare("SELECT COUNT(*) AS n FROM people WHERE city = 'London'").get() as { n: number };
  assert.equal(london.n, 55);

  const alistair = db.prepare("SELECT date_of_birth AS dob FROM people WHERE full_name = 'Alistair Finch'").get() as { dob: string };
  assert.equal(alistair.dob, '1977-01-28');

  const pending = db.prepare("SELECT team, age, tenure_years FROM people_v WHERE work_status = 'pending_arrival'").get() as Record<string, unknown>;
  assert.deepEqual({ ...pending }, { team: null, age: null, tenure_years: null });
});
