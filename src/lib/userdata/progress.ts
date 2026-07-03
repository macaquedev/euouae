// A single-file backup of everything the user has accumulated — their whole
// user database (card progress, review log, saved lists, preferences) plus
// every custom lexicon they've built — so it can be moved to another device or
// kept as a safety copy. Card progress is keyed on lexicon name, so a backup
// that dropped custom lexicons would restore progress pointing at lexicons that
// no longer load; both travel together here.
//
// The container is itself a SQLite database (no extra dependency — SQLite-WASM
// is already loaded), storing each app-data file verbatim as a blob. Restoring
// writes those files back and reloads the app, so nothing has to know how to
// merge live state.

import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { sqliteRuntime } from '$lib/sqlite/runtime';
import { openSerializedDbBytes } from '$lib/lexicon/sqlite';
import { exists, readFile, writeFile, removeFile } from '$lib/platform/storage';
import { customLexiconFilePaths, importCustomLexicons } from '$lib/lexicon/registry';
import { SAVED_ALPHABETS_FILE, importSavedAlphabets } from '$lib/lexicon/savedAlphabets';
import { USER_DB_FILE, userDb, persistUserData, suspendPersistence } from './db.svelte';

export const PROGRESS_FORMAT = 'euouae-progress';
export const PROGRESS_VERSION = 1;
/** File extension for a backup, e.g. `euouae-progress-2026-07-02.euouae`. */
export const PROGRESS_EXTENSION = 'euouae';

/** How an imported backup is brought in: overwrite everything, or fold it in. */
export type ImportMode = 'replace' | 'merge';

type Row = Record<string, SqlValue>;

const META_TABLE = 'bundle_meta';
const FILES_TABLE = 'bundle_files';

// The custom-lexicon path scheme owned by lexicon/registry.ts, mirrored here so
// the bundle can map its files back to lexicon names when merging.
const LEXICON_DIR = 'lexicons/';
const CUSTOM_MANIFEST = `${LEXICON_DIR}custom.json`;

/** A backup opened for inspection: the files it carries and a human summary. */
export interface ParsedProgress {
	readonly files: Map<string, Uint8Array>;
	readonly summary: ProgressSummary;
}

export interface ProgressSummary {
	/** When the backup was made, or null if the field is absent/unreadable. */
	readonly createdAt: number | null;
	/** Custom lexicons carried by the backup. */
	readonly lexicons: number;
	/** Card and list counts read from the packed user database, if readable. */
	readonly cards: number | null;
	readonly lists: number | null;
}

/** A friendly error for a file that isn't one of our backups. */
class NotAProgressBackup extends Error {
	constructor() {
		super('This file isn’t a euouae progress backup.');
		this.name = 'NotAProgressBackup';
	}
}

/**
 * Pack the whole of the user's progress into one backup file's bytes. Flushes
 * any pending in-memory edits to disk first so the snapshot is current.
 */
export async function exportProgress(): Promise<Uint8Array> {
	await persistUserData();

	const paths = [USER_DB_FILE, SAVED_ALPHABETS_FILE, ...(await customLexiconFilePaths())];
	const files: { path: string; data: Uint8Array }[] = [];
	for (const path of paths) {
		if (await exists(path)) files.push({ path, data: await readFile(path) });
	}

	const sqlite3 = await sqliteRuntime();
	const db = new sqlite3.oo1.DB();
	try {
		db.exec(
			`CREATE TABLE ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL);` +
				`CREATE TABLE ${FILES_TABLE} (path TEXT PRIMARY KEY, data BLOB NOT NULL);`
		);
		const meta: Record<string, string> = {
			format: PROGRESS_FORMAT,
			version: String(PROGRESS_VERSION),
			created_at: String(Date.now())
		};
		for (const [key, value] of Object.entries(meta)) {
			db.exec({ sql: `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)`, bind: [key, value] });
		}
		for (const { path, data } of files) {
			db.exec({ sql: `INSERT INTO ${FILES_TABLE} (path, data) VALUES (?, ?)`, bind: [path, data] });
		}
		// Copy out of the (possibly SharedArrayBuffer-backed) export into a plain
		// ArrayBuffer-backed array, as the DB snapshot code does.
		const raw = sqlite3.capi.sqlite3_js_db_export(db.pointer!);
		const bytes = new Uint8Array(raw.length);
		bytes.set(raw);
		return bytes;
	} finally {
		db.close();
	}
}

/**
 * Open and validate a backup's bytes without touching any app data, so the UI
 * can confirm the restore and show what it contains. Throws a friendly error if
 * the file isn't a euouae progress backup.
 */
export async function readProgressBundle(bytes: Uint8Array): Promise<ParsedProgress> {
	let db: Database | undefined;
	try {
		db = await openSerializedDbBytes(bytes);
	} catch {
		throw new NotAProgressBackup();
	}
	try {
		let createdAtRaw: string | undefined;
		const files = new Map<string, Uint8Array>();
		try {
			const format = db.selectValue(`SELECT value FROM ${META_TABLE} WHERE key = 'format'`);
			if (format !== PROGRESS_FORMAT) throw new NotAProgressBackup();
			createdAtRaw = db.selectValue(`SELECT value FROM ${META_TABLE} WHERE key = 'created_at'`) as
				| string
				| undefined;
			for (const row of db.selectObjects(`SELECT path, data FROM ${FILES_TABLE}`)) {
				files.set(row.path as string, row.data as Uint8Array);
			}
		} catch (err) {
			// A random SQLite file (e.g. a lexicon .db) has no bundle tables.
			if (err instanceof NotAProgressBackup) throw err;
			throw new NotAProgressBackup();
		}
		if (!files.has(USER_DB_FILE)) throw new NotAProgressBackup();

		const createdAt = createdAtRaw != null && /^\d+$/.test(createdAtRaw) ? Number(createdAtRaw) : null;
		const lexicons = [...files.keys()].filter(isCustomLexiconDb).length;
		const { cards, lists } = await countUserData(files.get(USER_DB_FILE)!);
		return { files, summary: { createdAt, lexicons, cards, lists } };
	} finally {
		db?.close();
	}
}

/**
 * Bring a backup into this device, either mode. Both leave the caller to reload
 * the app immediately afterwards so every store and engine re-opens from the
 * updated data.
 */
export async function applyProgressBundle(
	files: Map<string, Uint8Array>,
	mode: ImportMode
): Promise<void> {
	if (mode === 'merge') return mergeProgressBundle(files);
	return replaceProgressBundle(files);
}

/**
 * Replace all local progress with the backup: overwrite the user database and
 * swap in the backup's custom lexicons, dropping any local ones the backup
 * doesn't carry, so a restore is a faithful copy. Suspends this session's
 * persistence first so the stale in-memory DB can't clobber the restored file
 * before the reload.
 */
async function replaceProgressBundle(files: Map<string, Uint8Array>): Promise<void> {
	suspendPersistence();

	const stale = [...(await customLexiconFilePaths()), SAVED_ALPHABETS_FILE];
	for (const path of stale) {
		if (!files.has(path) && (await exists(path))) await removeFile(path);
	}
	for (const [path, data] of files) {
		await writeFile(path, data);
	}
}

/**
 * Fold the backup into this device's existing progress rather than replacing
 * it: newest review wins per card, review history and list words are unioned,
 * local preferences are kept, and only custom lexicons this device is missing
 * are added. Idempotent — importing the same backup twice changes nothing the
 * second time.
 */
async function mergeProgressBundle(files: Map<string, Uint8Array>): Promise<void> {
	const incomingBytes = files.get(USER_DB_FILE);
	if (!incomingBytes) throw new Error('This backup is missing its progress data.');

	const live = await userDb();
	const incoming = await openSerializedDbBytes(incomingBytes);
	try {
		mergeUserData(live, incoming);
	} finally {
		incoming.close();
	}

	const manifestBytes = files.get(CUSTOM_MANIFEST);
	const manifestJson = manifestBytes ? new TextDecoder().decode(manifestBytes) : undefined;
	const dbBytesByName = new Map<string, Uint8Array>();
	for (const [path, data] of files) {
		const name = customLexiconName(path);
		if (name) dbBytesByName.set(name, data);
	}
	await importCustomLexicons(manifestJson, dbBytesByName);

	// Fold in saved tile sets the backup carries that this device is missing.
	const alphabetsBytes = files.get(SAVED_ALPHABETS_FILE);
	await importSavedAlphabets(
		alphabetsBytes ? new TextDecoder().decode(alphabetsBytes) : undefined
	);

	await persistUserData();
}

/**
 * Merge the incoming user DB's rows into the live one, in a single transaction:
 * newest review wins per card, review history and list words are unioned, local
 * preferences are kept, lists are matched by (lexicon, name). Exported as the
 * pure core of a merge import so it can be exercised directly. Idempotent.
 */
export function mergeUserData(live: Database, incoming: Database): void {
	live.exec('BEGIN');
	try {
		// cards: the more recently reviewed copy of a card wins.
		for (const c of incoming.selectObjects(
			'SELECT lexicon,deck,question,correct,incorrect,streak,' +
				'last_correct,stability,difficulty,last_review FROM cards'
		)) {
			live.exec({
				sql:
					'INSERT INTO cards (lexicon,deck,question,correct,incorrect,streak,' +
					'last_correct,stability,difficulty,last_review) VALUES (?,?,?,?,?,?,?,?,?,?)' +
					' ON CONFLICT(lexicon,deck,question) DO UPDATE SET' +
					' correct=excluded.correct, incorrect=excluded.incorrect, streak=excluded.streak,' +
					' last_correct=excluded.last_correct, stability=excluded.stability,' +
					' difficulty=excluded.difficulty, last_review=excluded.last_review' +
					' WHERE COALESCE(excluded.last_review,-1) > COALESCE(cards.last_review,-1)',
				bind: [
					c.lexicon,
					c.deck,
					c.question,
					c.correct,
					c.incorrect,
					c.streak,
					c.last_correct,
					c.stability,
					c.difficulty,
					c.last_review
				]
			});
		}

		// review_log: append the history, skipping rows already present verbatim.
		const seen = new Set<string>();
		for (const r of live.selectObjects(
			'SELECT lexicon,deck,question,reviewed_at,grade FROM review_log'
		)) {
			seen.add(logKey(r));
		}
		for (const r of incoming.selectObjects(
			'SELECT lexicon,deck,question,reviewed_at,grade FROM review_log'
		)) {
			if (seen.has(logKey(r))) continue;
			seen.add(logKey(r));
			live.exec({
				sql: 'INSERT INTO review_log (lexicon,deck,question,reviewed_at,grade) VALUES (?,?,?,?,?)',
				bind: [r.lexicon, r.deck, r.question, r.reviewed_at, r.grade]
			});
		}

		// app_state: keep this device's values (selected lexicon, tuning); only
		// carry over keys it doesn't already have.
		for (const s of incoming.selectObjects('SELECT key,value FROM app_state')) {
			live.exec({
				sql: 'INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING',
				bind: [s.key, s.value]
			});
		}

		// lists: match an existing list by (lexicon, name) and union its words, or
		// create it. list ids differ between databases, so remap through the name.
		for (const l of incoming.selectObjects('SELECT id,lexicon,name,created FROM lists')) {
			let localId = live.selectValue(
				'SELECT id FROM lists WHERE lexicon=? AND name=? ORDER BY created, id LIMIT 1',
				[l.lexicon, l.name]
			) as number | undefined;
			if (localId == null) {
				live.exec({
					sql: 'INSERT INTO lists (lexicon,name,created) VALUES (?,?,?)',
					bind: [l.lexicon, l.name, l.created]
				});
				localId = live.selectValue('SELECT last_insert_rowid()') as number;
			}
			for (const w of incoming.selectObjects(
				'SELECT word,position FROM list_words WHERE list_id=?',
				[l.id]
			)) {
				live.exec({
					sql: 'INSERT OR IGNORE INTO list_words (list_id,word,position) VALUES (?,?,?)',
					bind: [localId, w.word, w.position]
				});
			}
		}

		live.exec('COMMIT');
	} catch (err) {
		try {
			live.exec('ROLLBACK');
		} catch {
			/* already unwound */
		}
		throw err;
	}
}

function logKey(r: Row): string {
	return [r.lexicon, r.deck, r.question, r.reviewed_at, r.grade].join('\u0000');
}

function isCustomLexiconDb(path: string): boolean {
	return path.startsWith(LEXICON_DIR) && path.endsWith('.db');
}

/** The lexicon name for a `lexicons/<name>.db` path, or null for anything else. */
function customLexiconName(path: string): string | null {
	if (!isCustomLexiconDb(path)) return null;
	return path.slice(LEXICON_DIR.length, -'.db'.length);
}

/** Best-effort card/list counts from a packed user DB, for the confirm dialog. */
async function countUserData(
	userBytes: Uint8Array
): Promise<{ cards: number | null; lists: number | null }> {
	let db: Database | undefined;
	try {
		db = await openSerializedDbBytes(userBytes);
		return {
			cards: Number(db.selectValue('SELECT count(*) FROM cards')),
			lists: Number(db.selectValue('SELECT count(*) FROM lists'))
		};
	} catch {
		return { cards: null, lists: null };
	} finally {
		db?.close();
	}
}
