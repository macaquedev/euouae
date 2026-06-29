// The SQLite-WASM module, initialised once and shared by every database we open:
// the read-only in-memory lexicons and the writable OPFS user store alike.

import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let initPromise: Promise<Sqlite3Static> | undefined;

export function sqliteRuntime(): Promise<Sqlite3Static> {
	return (initPromise ??= sqlite3InitModule());
}
