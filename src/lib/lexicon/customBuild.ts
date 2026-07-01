// Build a custom lexicon entirely in the webview: parse a word list, derive every
// column (the same pure core the CLI build uses), and assemble a canonical SQLite
// database in memory via SQLite-WASM, returning the serialized bytes to persist.
// No worker, no Bun — this is the runtime twin of scripts/build-lexicon.ts.

import { sqliteRuntime } from '$lib/sqlite/runtime';
import type { Alphabet } from './alphabet';
import { buildRows, parseSourceChunked, CANONICAL_SCHEMA, COLUMN_ORDER, type BuildProgress } from './build';

export interface BuiltCustomLexicon {
	readonly bytes: Uint8Array;
	readonly wordCount: number;
	/** Words dropped for containing a character outside the chosen tile set (see
	 *  `BuildResult.skipped`) — e.g. an English word list built against a Spanish
	 *  tile set with no K or W. */
	readonly skipped: number;
}

export type CustomBuildPhase = BuildProgress['phase'] | 'writing';

export interface CustomBuildOptions {
	readonly onProgress?: (progress: { phase: CustomBuildPhase; done: number; total: number }) => void;
	readonly signal?: AbortSignal;
}

// Writing rows into the WASM SQLite DB is fast per-row, but a 100k+ word custom
// lexicon still adds up to a noticeable freeze without periodic yields.
const WRITE_CHUNK_SIZE = 2000;

function checkAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
}

/**
 * Parse and compile a `WORD<TAB>definition` word list into lexicon bytes using
 * the given tile set. Throws if the list yields no usable words — either none
 * were entered, or none of them are composed entirely of this tile set's tiles.
 * Reports progress and honors cancellation via `options` throughout, since a
 * large word list can take long enough to want both.
 */
export async function buildCustomLexicon(
	alphabet: Alphabet,
	text: string,
	options: CustomBuildOptions = {}
): Promise<BuiltCustomLexicon> {
	const { onProgress, signal } = options;
	const parsed = await parseSourceChunked(text, { onProgress, signal });
	if (parsed.length === 0) {
		throw new Error('No words found. Expected one WORD per line (TAB-separated definition optional).');
	}
	const { rows, skipped } = await buildRows(alphabet, parsed, { onProgress, signal });
	if (rows.length === 0) {
		throw new Error(`None of these words are composed entirely of the ${alphabet.name} tile set.`);
	}
	checkAborted(signal);

	const sqlite3 = await sqliteRuntime();
	const db = new sqlite3.oo1.DB();
	try {
		db.exec(CANONICAL_SCHEMA);

		const placeholders = COLUMN_ORDER.map(() => '?').join(',');
		const insert = db.prepare(`INSERT INTO words VALUES (${placeholders})`);
		try {
			db.exec('BEGIN');
			for (let i = 0; i < rows.length; i++) {
				insert.bind(COLUMN_ORDER.map((c) => rows[i][c])).stepReset();
				if ((i + 1) % WRITE_CHUNK_SIZE === 0 || i === rows.length - 1) {
					checkAborted(signal);
					onProgress?.({ phase: 'writing', done: i + 1, total: rows.length });
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}
			db.exec('COMMIT');
		} finally {
			insert.finalize();
		}

		// Copy out of the WASM heap into a plain ArrayBuffer-backed array we own.
		const exported = sqlite3.capi.sqlite3_js_db_export(db.pointer!);
		const bytes = new Uint8Array(exported.length);
		bytes.set(exported);
		return { bytes, wordCount: rows.length, skipped };
	} finally {
		db.close();
	}
}
