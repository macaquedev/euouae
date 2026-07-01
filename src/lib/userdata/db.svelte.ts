// The single writable database for everything the user accumulates: card state,
// the review log, and saved lists. The DB lives in memory (SQLite-WASM) and is
// snapshotted to one real file in the Tauri app's data directory
// (e.g. ~/.local/share/com.euouae.app/euouae.sqlite3) — a file you can find,
// back up, and copy between machines. Loaded on open, rewritten after each
// change. This is a desktop (Tauri) app: there is no browser storage fallback.

import type { Database } from '@sqlite.org/sqlite-wasm';
import { BaseDirectory, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { sqliteRuntime } from '$lib/sqlite/runtime';

const SNAPSHOT_FILE = 'euouae.sqlite3';
const BASE = BaseDirectory.AppData;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS cards (
	lexicon TEXT NOT NULL,
	deck TEXT NOT NULL,
	question TEXT NOT NULL,
	correct INTEGER NOT NULL DEFAULT 0,
	incorrect INTEGER NOT NULL DEFAULT 0,
	streak INTEGER NOT NULL DEFAULT 0,
	last_correct INTEGER,
	stability REAL,
	difficulty REAL,
	last_review INTEGER,
	PRIMARY KEY (lexicon, deck, question)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS app_state (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS review_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	lexicon TEXT NOT NULL,
	deck TEXT NOT NULL,
	question TEXT NOT NULL,
	reviewed_at INTEGER NOT NULL,
	grade TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	lexicon TEXT NOT NULL,
	name TEXT NOT NULL,
	created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS list_words (
	list_id INTEGER NOT NULL,
	word TEXT NOT NULL,
	position INTEGER,
	PRIMARY KEY (list_id, word)
) WITHOUT ROWID;
`;

/** Columns present on a table, per the current schema. */
function columnsOf(db: Database, table: string): string[] {
	return db.selectObjects(`PRAGMA table_info(${table})`).map((r) => r.name as string);
}

/** Add a column to an existing table if a prior schema version lacked it. */
function ensureColumn(db: Database, table: string, column: string, type: string): void {
	if (!columnsOf(db, table).includes(column)) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
	}
}

/**
 * Fold the retired Leitner columns into the shared review state, then drop them.
 * The Leitner box is now derived in place as max(0, streak) and its due date is
 * anchored on the shared `last_review`, so cardbox-only cards must carry their
 * old anchor and box forward or they'd read as never-studied. A no-op once the
 * columns are gone (fresh installs and already-migrated DBs).
 */
function retireCardboxColumns(db: Database): void {
	const cols = columnsOf(db, 'cards');
	if (cols.includes('cardbox_reviewed')) {
		db.exec(
			'UPDATE cards SET last_review = cardbox_reviewed' +
				' WHERE last_review IS NULL AND cardbox_reviewed IS NOT NULL'
		);
	}
	if (cols.includes('cardbox')) {
		// Restore the box for legacy cardbox cards whose streak never tracked it.
		db.exec('UPDATE cards SET streak = cardbox WHERE streak = 0 AND cardbox > 0');
		db.exec('ALTER TABLE cards DROP COLUMN cardbox');
	}
	if (cols.includes('cardbox_reviewed')) {
		db.exec('ALTER TABLE cards DROP COLUMN cardbox_reviewed');
	}
}

interface UserDb {
	db: Database;
	export(): Uint8Array;
}

let dbPromise: Promise<UserDb> | undefined;

async function loadSnapshot(): Promise<Uint8Array | null> {
	if (!(await exists(SNAPSHOT_FILE, { baseDir: BASE }))) return null;
	const bytes = await readFile(SNAPSHOT_FILE, { baseDir: BASE });
	return bytes.length > 0 ? bytes : null;
}

async function writeSnapshot(bytes: Uint8Array): Promise<void> {
	await mkdir('', { baseDir: BASE, recursive: true }).catch(() => {}); // ensure the data dir
	await writeFile(SNAPSHOT_FILE, bytes, { baseDir: BASE });
}

async function open(): Promise<UserDb> {
	const sqlite3 = await sqliteRuntime();
	const db = new sqlite3.oo1.DB();

	const bytes = await loadSnapshot();
	if (bytes) {
		const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
		db.checkRc(
			sqlite3.capi.sqlite3_deserialize(
				db.pointer!,
				'main',
				ptr,
				bytes.length,
				bytes.length,
				sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
			)
		);
	}
	db.exec(MIGRATIONS);
	// Lists predating saved-order tracking get a nullable position column.
	ensureColumn(db, 'list_words', 'position', 'INTEGER');
	// Cards predating FSRS / on-demand scheduling get the new per-algorithm
	// columns (all nullable until first review under that algorithm).
	ensureColumn(db, 'cards', 'stability', 'REAL');
	ensureColumn(db, 'cards', 'difficulty', 'REAL');
	ensureColumn(db, 'cards', 'last_review', 'INTEGER');
	// The Leitner box is now derived from `streak`, not stored — fold the old
	// cardbox columns into the shared review state and drop them.
	retireCardboxColumns(db);

	return { db, export: () => sqlite3.capi.sqlite3_js_db_export(db.pointer!) };
}

/**
 * The shared, lazily-opened user database (one per app instance). Clears the
 * cached promise on failure so a subsequent call — including the user hitting
 * "Retry" after an open failure — attempts `open()` again instead of forever
 * replaying the same cached rejection.
 */
function getDb(): Promise<UserDb> {
	if (!dbPromise) {
		dbPromise = open().catch((err) => {
			dbPromise = undefined;
			throw err;
		});
	}
	return dbPromise;
}

export async function userDb(): Promise<Database> {
	return (await getDb()).db;
}

/** Reactive so the layout can surface a banner the instant a snapshot write
 *  fails — every mutator in lists.ts/cards.ts/store.svelte.ts fires
 *  `persistUserData()` without awaiting it, so this is the one place a failed
 *  write (disk full, permissions, OPFS quota) can actually reach the user
 *  instead of dying as a silent unhandled rejection. */
export const persistStatus = $state<{ error: string | null }>({ error: null });

let writing = false;
let writeAgain = false;

/**
 * Snapshot the user DB to its file. Coalesces concurrent calls (a write requested
 * mid-write is folded into one trailing write), so rapid reviews stay cheap.
 * Never rejects — a failure is recorded in `persistStatus.error` instead, since
 * every caller invokes this fire-and-forget.
 */
export async function persistUserData(): Promise<void> {
	// No early "nothing opened yet" guard: every real caller is either a mutator
	// that already called userDb() itself, or the Retry button, which only ever
	// appears after a save was attempted and failed — getDb() below re-attempts
	// open() in that case rather than silently no-oping the retry.
	if (writing) {
		writeAgain = true;
		return;
	}
	writing = true;
	try {
		do {
			writeAgain = false;
			const snapshot = (await getDb()).export();
			// Copy into an ArrayBuffer-backed array (the export may be SharedArrayBuffer-backed).
			const bytes = new Uint8Array(snapshot.length);
			bytes.set(snapshot);
			await writeSnapshot(bytes);
		} while (writeAgain);
		persistStatus.error = null;
	} catch (err) {
		persistStatus.error = err instanceof Error ? err.message : String(err);
	} finally {
		writing = false;
	}
}

/**
 * Hold the window open on close until the last snapshot write lands, so a
 * write in flight (or one merely coalesced via `writeAgain`) isn't abandoned
 * mid-flight. Every mutator fires `persistUserData()` fire-and-forget, so
 * without this, quitting right after a review/edit can silently lose it.
 * No-op outside the Tauri shell (there's no other window-close signal to
 * hook, and no other place data would be lost from).
 */
export async function installCloseFlush(): Promise<void> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
	const { getCurrentWindow } = await import('@tauri-apps/api/window');
	const win = getCurrentWindow();
	let closing = false;
	await win.onCloseRequested(async (event) => {
		if (closing || !dbPromise) return; // nothing ever opened, nothing to flush
		event.preventDefault();
		closing = true;
		await persistUserData();
		await win.destroy();
	});
}
