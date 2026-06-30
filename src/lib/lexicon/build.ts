// The pure, runtime-agnostic core of building a lexicon from a `WORD<TAB>definition`
// word list. Everything except the definition is derived from the word list
// itself: alphagrams, hooks, point values, counts, and draw probability
// (combinatorics). Playability needs a separate play-count file and is left null.
//
// This module knows nothing about *where* the rows are written — the CLI script
// (scripts/build-lexicon.ts, bun:sqlite) and the in-app importer (SQLite-WASM)
// each take these rows and the schema and fill their own database.

import type { Alphabet } from './alphabet';
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

/** Parse a `WORD<TAB>definition` word list (blank and `#` comment lines skipped). */
export function parseSource(text: string): ParsedEntry[] {
	const entries: ParsedEntry[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		if (line === '' || line.startsWith('#')) continue;
		const tab = line.indexOf('\t');
		const word = (tab === -1 ? line : line.slice(0, tab)).trim().toUpperCase();
		if (word === '' || seen.has(word)) continue;
		seen.add(word);
		const definition = tab === -1 ? '' : line.slice(tab + 1).trim();
		entries.push({ word, definition, partOfSpeech: extractPartOfSpeech(definition) });
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

/**
 * Derive every column for every word, ranked by draw probability within length.
 * Returns rows in input order, plus a count of words dropped for not being
 * composed entirely of this alphabet's tiles (see `BuildResult.skipped`).
 */
export function buildRows(alphabet: Alphabet, parsed: ReadonlyArray<ParsedEntry>): BuildResult {
	const valid = parsed.filter((e) => alphabet.tokenizeStrict(e.word) !== null);
	const skipped = parsed.length - valid.length;

	const combinations = combinationsFor(alphabet);

	const wordSet = new Set(valid.map((e) => e.word));
	const isWord = (w: string) => wordSet.has(w);

	const groupSize = new Map<string, number>();
	const built = valid.map((e) => {
		const tiles = alphabet.tokenize(e.word);
		const alphagram = alphabet.alphagram(e.word);
		groupSize.set(alphagram, (groupSize.get(alphagram) ?? 0) + 1);
		return { ...e, tiles, length: tiles.length, alphagram, combinations: combinations(e.word) };
	});

	const orders = probabilityOrders(built);

	const rows = built.map((e) => {
		const order = orders.get(e.word)!;
		// Drop one tile, not one character, so hooks are correct for multi-character
		// tiles (e.g. removing CH from CHACHA, not just C).
		const { tiles } = e;
		const withoutFirstTile = tiles.slice(1).map((t) => t.glyph).join('');
		const withoutLastTile = tiles.slice(0, -1).map((t) => t.glyph).join('');
		return {
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
		};
	});

	return { rows, skipped };
}
