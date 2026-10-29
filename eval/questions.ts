import type { DatabaseSync } from 'node:sqlite';

// What a correct answer must contain: every number (within tol) and every name.
export interface Expected {
  numbers?: { value: number; tol?: number }[];
  names?: string[];
}

export interface Question {
  id: string;
  question: string;
  expected: (db: DatabaseSync) => Expected;
}

// Expected answers are computed here with plain SQL on the `people` table (and JS for ages),
// not through the MCP query compiler or the view, so a bug there can't make a wrong answer look right.
const count = (db: DatabaseSync, where: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM people WHERE ${where}`).get() as { n: number }).n;

function ages(db: DatabaseSync): number[] {
  const today = new Date();
  const rows = db.prepare('SELECT date_of_birth FROM people WHERE date_of_birth IS NOT NULL').all() as { date_of_birth: string }[];
  return rows.map(({ date_of_birth }) => {
    const [y, m, d] = date_of_birth.split('-').map(Number);
    const hadBirthday = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
    return today.getFullYear() - y - (hadBirthday ? 0 : 1);
  });
}

// The brief's questions plus a few from the plan. "Average annual salary across the company in USD"
// is left out: it needs currency conversion, which the server deliberately doesn't do.
export const QUESTIONS: Question[] = [
  {
    id: 'london',
    question: 'How many people live in London?',
    expected: (db) => ({ numbers: [{ value: count(db, "city = 'London'") }] }),
  },
  {
    id: 'israel',
    question: 'How many people are based in Israel?',
    expected: (db) => ({ numbers: [{ value: count(db, "country = 'Israel'") }] }),
  },
  {
    id: 'avg-age',
    question: 'What is the average age of employees?',
    expected: (db) => {
      const a = ages(db);
      return { numbers: [{ value: a.reduce((s, x) => s + x, 0) / a.length, tol: 0.1 }] };
    },
  },
  {
    id: 'bread-team',
    question: 'How many people are in the Bread team?',
    expected: (db) => ({ numbers: [{ value: count(db, "team = 'Bread'") }] }),
  },
  {
    id: 'top-office',
    question: 'Which office has the most people?',
    expected: (db) => {
      const top = db.prepare('SELECT office, COUNT(*) AS n FROM people WHERE office IS NOT NULL GROUP BY office ORDER BY n DESC LIMIT 1').get() as { office: string; n: number };
      return { names: [top.office], numbers: [{ value: top.n }] };
    },
  },
  {
    id: 'orly-reports',
    question: 'Who reports to Orly Naveh?',
    expected: (db) => ({
      names: (db.prepare("SELECT full_name FROM people WHERE reports_to = 'Orly Naveh'").all() as { full_name: string }[]).map((r) => r.full_name),
    }),
  },
  {
    id: 'longest-tenure',
    question: 'Who has been at the company the longest?',
    expected: (db) => {
      const first = db.prepare('SELECT full_name FROM people WHERE start_date IS NOT NULL ORDER BY start_date LIMIT 1').get() as { full_name: string };
      return { names: [first.full_name] };
    },
  },
  {
    id: 'nyc-salary',
    question: "What's the average salary at the NYC office?",
    expected: (db) => {
      const { avg } = db.prepare("SELECT AVG(salary_amount) AS avg FROM people WHERE city = 'New York' AND salary_currency = 'USD' AND salary_period = 'yearly'").get() as { avg: number };
      return { numbers: [{ value: avg, tol: 1 }] };
    },
  },
  {
    id: 'not-started',
    question: "How many people haven't started yet?",
    expected: (db) => ({ numbers: [{ value: count(db, "work_status = 'pending_arrival'") }] }),
  },
  {
    id: 'over-40',
    question: 'How many people are older than 40?',
    expected: (db) => ({ numbers: [{ value: ages(db).filter((a) => a > 40).length }] }),
  },
  {
    id: 'tlv-gender',
    question: 'What is the gender breakdown in Tel Aviv?',
    expected: (db) => ({
      numbers: (db.prepare("SELECT COUNT(*) AS n FROM people WHERE city = 'Tel Aviv' GROUP BY gender").all() as { n: number }[]).map((r) => ({ value: r.n })),
    }),
  },
];
