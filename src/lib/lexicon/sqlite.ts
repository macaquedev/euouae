// Loads SQLite-WASM and opens a bundled lexicon DB read-only in memory. The
// lexicon is immutable, so we deserialize the fetched bytes straight into an
// in-memory database — no OPFS, no headers, no worker. (Writable user data will
// use a persistent OPFS database separately.)

import { type Database } from '@sqlite.org/sqlite-wasm';
import { sqliteRuntime } from '$lib/sqlite/runtime';

/** Fetch a SQLite file and open it as an in-memory, read-only database. */
export async function openSerializedDb(url: string): Promise<Database> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch lexicon "${url}": ${response.status} ${response.statusText}`);
	}
	return openSerializedDbBytes(new Uint8Array(await response.arrayBuffer()));
}

/** Open already-fetched SQLite bytes as an in-memory, read-only database. */
export async function openSerializedDbBytes(bytes: Uint8Array): Promise<Database> {
	const sqlite3 = await sqliteRuntime();

	const db = new sqlite3.oo1.DB();
	const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
	const rc = sqlite3.capi.sqlite3_deserialize(
		db.pointer!,
		'main',
		ptr,
		bytes.length,
		bytes.length,
		sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
	);
	db.checkRc(rc);
	return db;
}
