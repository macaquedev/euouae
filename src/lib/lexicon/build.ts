// The pure, runtime-agnostic core of building a lexicon from a `WORD<TAB>definition`
// word list. Everything except the definition is derived from the word list
// itself: alphagrams, hooks, point values, counts, and draw probability
// (combinatorics). Playability needs a separate play-count file and is left null.
//
// This module knows nothing about *where* the rows are written — the CLI script
// (scripts/build-lexicon.ts, bun:sqlite) and the in-app importer (SQLite-WASM)
// each take these rows and the schema and fill their own database.

import type { Alphabet, Tile } from './alphabet';
import type { ByBlanks } from './types';
import { combinationsFor, probabilityOrders } from './probability';

export interface ParsedEntry {
	readonly word: string;
	readonly definition: string;
	readonly partOfSpeech: string; // comma-joined, e.g. "n,v"
}

// One row per word, keyed exactly like the CANONICAL_SCHEMA columns so a caller
// can bind it straight into an INSERT.
export interface LexiconRow {
	word: string;
	tiles: string;
	length: number;
	alphagram: string;
	point_value: number;
	num_anagrams: number;
	num_unique_letters: number;
	num_vowels: number;
	front_hooks: string;
	back_hooks: string;
	is_front_hook: number;
	is_back_hook: number;
	combinations0: number;
	combinations1: number;
	combinations2: number;
	probability_order0: number;
	probability_order1: number;
	probability_order2: number;
	playability: number | null;
	playability_order: number | null;
	part_of_speech: string;
	definition: string;
}

export const CANONICAL_SCHEMA = `
CREATE TABLE words (
  word TEXT PRIMARY KEY,
  tiles TEXT NOT NULL,
  length INTEGER NOT NULL,
  alphagram TEXT NOT NULL,
  point_value INTEGER NOT NULL,
  num_anagrams INTEGER NOT NULL,
  num_unique_letters INTEGER NOT NULL,
  num_vowels INTEGER NOT NULL,
  front_hooks TEXT NOT NULL,
  back_hooks TEXT NOT NULL,
  is_front_hook INTEGER NOT NULL,
  is_back_hook INTEGER NOT NULL,
  combinations0 INTEGER NOT NULL,
  combinations1 INTEGER NOT NULL,
  combinations2 INTEGER NOT NULL,
  probability_order0 INTEGER NOT NULL,
  probability_order1 INTEGER NOT NULL,
  probability_order2 INTEGER NOT NULL,
  playability REAL,
  playability_order INTEGER,
  part_of_speech TEXT NOT NULL,
  definition TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_alphagram ON words(alphagram);
CREATE INDEX idx_length ON words(length);
CREATE INDEX idx_prob0 ON words(length, probability_order0);
`;

// The columns in CANONICAL_SCHEMA order, for building an INSERT statement.
export const COLUMN_ORDER: ReadonlyArray<keyof LexiconRow> = [
	'word', 'tiles', 'length', 'alphagram', 'point_value', 'num_anagrams',
	'num_unique_letters', 'num_vowels', 'front_hooks', 'back_hooks',
	'is_front_hook', 'is_back_hook', 'combinations0', 'combinations1',
	'combinations2', 'probability_order0', 'probability_order1',
	'probability_order2', 'playability', 'playability_order', 'part_of_speech',
	'definition'
];

/** Pull part-of-speech codes from the `[n -S]` / `[v ...]` brackets, in order. */
export function extractPartOfSpeech(definition: string): string {
	const tags: string[] = [];
	for (const match of definition.matchAll(/\[([a-z]+)/g)) {
		if (!tags.includes(match[1])) tags.push(match[1]);
	}
	return tags.join(',');
}

/** Parse one non-empty, non-comment line; null for blank/`#` lines or an empty word. */
function parseLine(line: string): ParsedEntry | null {
	if (line === '' || line.startsWith('#')) return null;
	const tab = line.indexOf('\t');
	const word = (tab === -1 ? line : line.slice(0, tab)).trim().toUpperCase();
	if (word === '') return null;
	const definition = tab === -1 ? '' : line.slice(tab + 1).trim();
	return { word, definition, partOfSpeech: extractPartOfSpeech(definition) };
}

/** Parse a `WORD<TAB>definition` word list (blank and `#` comment lines skipped). */
export function parseSource(text: string): ParsedEntry[] {
	const entries: ParsedEntry[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		const entry = parseLine(line);
		if (!entry || seen.has(entry.word)) continue;
		seen.add(entry.word);
		entries.push(entry);
	}
	return entries;
}

export interface BuildResult {
	readonly rows: LexiconRow[];
	/**
	 * Words dropped because they contain a character that isn't one of the
	 * alphabet's tiles — e.g. an English-derived word list ("AAK", "AAW") fed to
	 * a Spanish tile set with no K or W. Without this filter, those characters
	 * would silently vanish during tokenization and the word would collapse into
	 * a shorter, wrong entry (here, a second, corrupt "AA") instead of being left
	 * out, so a search like a "AA" pattern would falsely also match "AAK".
	 */
	readonly skipped: number;
}

export interface BuildProgress {
	readonly phase: 'parsing' | 'deriving' | 'ranking' | 'rows';
	readonly done: number;
	readonly total: number;
}

export interface BuildOptions {
	/** Called after each chunk with cumulative progress for the current phase. */
	readonly onProgress?: (progress: BuildProgress) => void;
	/** Checked between chunks; an aborted signal throws `DOMException('AbortError')`. */
	readonly signal?: AbortSignal;
}

// Large word lists (100k+ entries) make the per-word tokenize/hook/combinatorics
// work below slow enough to freeze the tab for seconds; yielding every CHUNK_SIZE
// words keeps the UI painting a progress bar and responsive to cancellation.
const CHUNK_SIZE = 2000;

function yieldToUI(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function checkAborted(signal: BuildOptions['signal']): void {
	if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
}

/**
 * Same parse as `parseSource`, but chunked and yielding to the event loop (and
 * checking `signal`) between chunks — for a large custom word list, the plain
 * synchronous parse would freeze the tab and ignore Cancel for the whole parse
 * phase before the rest of the (already-chunked) build ever got a chance to run.
 */
export async function parseSourceChunked(
	text: string,
	options: BuildOptions = {}
): Promise<ParsedEntry[]> {
	const { onProgress, signal } = options;
	const entries: ParsedEntry[] = [];
	const seen = new Set<string>();
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const entry = parseLine(lines[i]);
		if (entry && !seen.has(entry.word)) {
			seen.add(entry.word);
			entries.push(entry);
		}
		if ((i + 1) % CHUNK_SIZE === 0 || i === lines.length - 1) {
			checkAborted(signal);
			onProgress?.({ phase: 'parsing', done: i + 1, total: lines.length });
			await yieldToUI();
		}
	}
	return entries;
}

interface BuiltEntry extends ParsedEntry {
	readonly tiles: readonly Tile[];
	readonly length: number;
	readonly alphagram: string;
	readonly combinations: ByBlanks;
}

/**
 * Derive every column for every word, ranked by draw probability within length.
 * Returns rows in input order, plus a count of words dropped for not being
 * composed entirely of this alphabet's tiles (see `BuildResult.skipped`).
 * Processes (and reports progress on) the word list in chunks, yielding to the
 * event loop between them so a large custom lexicon doesn't freeze the tab and
 * can be cancelled mid-build via `options.signal`.
 */
export async function buildRows(
	alphabet: Alphabet,
	parsed: ReadonlyArray<ParsedEntry>,
	options: BuildOptions = {}
): Promise<BuildResult> {
	const { onProgress, signal } = options;

	const valid = parsed.filter((e) => alphabet.tokenizeStrict(e.word) !== null);
	const skipped = parsed.length - valid.length;

	const combinations = combinationsFor(alphabet);

	const wordSet = new Set(valid.map((e) => e.word));
	const isWord = (w: string) => wordSet.has(w);

	const groupSize = new Map<string, number>();
	const built: BuiltEntry[] = [];
	for (let i = 0; i < valid.length; i++) {
		const e = valid[i];
		const tiles = alphabet.tokenize(e.word);
		const alphagram = alphabet.alphagram(e.word);
		groupSize.set(alphagram, (groupSize.get(alphagram) ?? 0) + 1);
		built.push({ ...e, tiles, length: tiles.length, alphagram, combinations: combinations(e.word) });

		if ((i + 1) % CHUNK_SIZE === 0 || i === valid.length - 1) {
			checkAborted(signal);
			onProgress?.({ phase: 'deriving', done: i + 1, total: valid.length });
			await yieldToUI();
		}
	}

	const orders = probabilityOrders(built);
	onProgress?.({ phase: 'ranking', done: built.length, total: built.length });
	await yieldToUI();
	checkAborted(signal);

	const rows: LexiconRow[] = [];
	for (let i = 0; i < built.length; i++) {
		const e = built[i];
		const order = orders.get(e.word)!;
		// Drop one tile, not one character, so hooks are correct for multi-character
		// tiles (e.g. removing CH from CHACHA, not just C).
		const { tiles } = e;
		const withoutFirstTile = tiles.slice(1).map((t) => t.glyph).join('');
		const withoutLastTile = tiles.slice(0, -1).map((t) => t.glyph).join('');
		rows.push({
			word: e.word,
			tiles: alphabet.encode(e.word),
			length: tiles.length,
			alphagram: e.alphagram,
			point_value: alphabet.pointValue(e.word),
			num_anagrams: groupSize.get(e.alphagram)!,
			num_unique_letters: alphabet.uniqueTileCount(e.word),
			num_vowels: alphabet.vowelCount(e.word),
			// Stored the same way `tiles` is: one code point per tile, so a multi-
			// character glyph (e.g. Spanish "CH") never collides with two single ones.
			front_hooks: alphabet.encodeGlyphs(alphabet.frontHooks(e.word, isWord)),
			back_hooks: alphabet.encodeGlyphs(alphabet.backHooks(e.word, isWord)),
			is_front_hook: Number(isWord(withoutFirstTile)),
			is_back_hook: Number(isWord(withoutLastTile)),
			combinations0: e.combinations[0],
			combinations1: e.combinations[1],
			combinations2: e.combinations[2],
			probability_order0: order[0],
			probability_order1: order[1],
			probability_order2: order[2],
			playability: null,
			playability_order: null,
			part_of_speech: e.partOfSpeech,
			definition: e.definition
		});

		if ((i + 1) % CHUNK_SIZE === 0 || i === built.length - 1) {
			checkAborted(signal);
			onProgress?.({ phase: 'rows', done: i + 1, total: built.length });
			await yieldToUI();
		}
	}

	return { rows, skipped };
}
