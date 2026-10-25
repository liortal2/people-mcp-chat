import { DatabaseSync } from 'node:sqlite';

export const DB_PATH = process.env.DB_PATH ?? 'data/people.db';

// Read-only: the server can never modify the data, whatever a query says.
export function openDb(path = DB_PATH): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}
