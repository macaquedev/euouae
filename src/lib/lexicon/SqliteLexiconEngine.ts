// LexiconEngine backed by a read-only SQLite-WASM database. All queries go
// through here, so the rest of the app never writes SQL or touches column names.

import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { bool, num, numOrNull, str } from '$lib/sqlite/values';
import { ALPHABET, alphagram } from './letters';
import type {
	ByBlanks,
	ColumnWidths,
	LexiconEngine,
	RangeField,
	SearchCondition,
	SearchResult,
	SearchSort,
	SortColumn,
	SearchSpec,
	WordEntry,
	WordWindow
} from './types';

type Row = Record<string, SqlValue>;

const COLUMNS = `word, length, alphagram, point_value, num_anagrams, num_unique_letters,
	num_vowels, front_hooks, back_hooks, is_front_hook, is_back_hook,
	combinations0, combinations1, combinations2,
	probability_order0, probability_order1, probability_order2,
	playability, playability_order, part_of_speech, definition`;

function byBlanks(v0: SqlValue, v1: SqlValue, v2: SqlValue): ByBlanks {
	return { 0: num(v0), 1: num(v1), 2: num(v2) };
}

function rowToEntry(r: Row): WordEntry {
	const pos = str(r.part_of_speech);
	return {
		word: str(r.word),
		length: num(r.length),
		alphagram: str(r.alphagram),
		pointValue: num(r.point_value),
		numAnagrams: num(r.num_anagrams),
		numUniqueLetters: num(r.num_unique_letters),
		numVowels: num(r.num_vowels),
		frontHooks: str(r.front_hooks),
		backHooks: str(r.back_hooks),
		isFrontHook: bool(r.is_front_hook),
		isBackHook: bool(r.is_back_hook),
		playability: numOrNull(r.playability),
		playabilityOrder: numOrNull(r.playability_order),
		combinations: byBlanks(r.combinations0, r.combinations1, r.combinations2),
		probabilityOrder: byBlanks(r.probability_order0, r.probability_order1, r.probability_order2),
		partOfSpeech: pos ? pos.split(',') : [],
		definition: str(r.definition)
	};
}

const RANGE_COLUMN: Readonly<Record<RangeField, string>> = {
	length: 'length',
	numVowels: 'num_vowels',
	numUniqueLetters: 'num_unique_letters',
	pointValue: 'point_value',
	numAnagrams: 'num_anagrams',
	probabilityOrder: 'probability_order0'
};

// The primary expression each sortable column orders by. The direction is
// applied per call; `word` is appended as a stable tie-break so equal rows keep
// a deterministic order. Probability is grouped by length (its rank is
// within-length), which is also the index-backed fast path.
const SORT_KEY: Readonly<Record<SortColumn, string>> = {
	word: 'word',
	length: 'length',
	pointValue: 'point_value',
	probability: 'length, probability_order0'
};

function orderClause({ column, direction }: SearchSort): string {
	const dir = direction === 'desc' ? 'DESC' : 'ASC';
	const primary = SORT_KEY[column]
		.split(', ')
		.map((key) => `${key} ${dir}`)
		.join(', ');
	return column === 'word' ? primary : `${primary}, word ASC`;
}

/** Per-letter occurrence counts of `letters`, e.g. "EEN" -> {E:2, N:1}. */
function letterCounts(letters: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const letter of letters) counts.set(letter, (counts.get(letter) ?? 0) + 1);
	return counts;
}

/** Translate one condition into a SQL fragment + bound params, or null if empty. */
interface CompiledClause {
	sql: string;
	params: SqlValue[];
}

function compileCondition(condition: SearchCondition): CompiledClause | null {
	if (condition.kind === 'range') {
		const column = RANGE_COLUMN[condition.type];
		if (condition.min === condition.max) {
			return { sql: `${column} = ?`, params: [condition.min] };
		}
		return { sql: `${column} BETWEEN ? AND ?`, params: [condition.min, condition.max] };
	}

	const value = condition.value.toUpperCase().replace(/\s+/g, '');
	const not = condition.negated;

	switch (condition.type) {
		case 'pattern': {
			if (!value) return null;
			return { sql: not ? 'word NOT GLOB ?' : 'word GLOB ?', params: [value] };
		}
		case 'anagram': {
			// "?" is one blank and "*" is any number of blanks: an anagram with wild
			// tiles is a word containing every fixed letter (with multiplicity), with
			// the blank slots left unconstrained. "*" lifts the length to a minimum;
			// without it the tile count is exact. No blanks at all keeps the fast,
			// index-backed alphagram lookup.
			const { fixed, blanks, open } = splitRack(value);
			if (!fixed && blanks === 0 && !open) return null;
			if (blanks === 0 && !open) return { sql: 'alphagram = ?', params: [alphagram(fixed)] };
			const clauses = [`length ${open ? '>=' : '='} ?`];
			const params: SqlValue[] = [fixed.length + blanks];
			for (const [letter, n] of letterCounts(fixed)) {
				clauses.push('word GLOB ?');
				params.push('*' + `${letter}*`.repeat(n));
			}
			return { sql: clauses.join(' AND '), params };
		}
		case 'subanagram': {
			// Each "?" is a wild tile that may stand for any letter or go unused. "*"
			// is ignored here: unlimited blanks would make every word a subanagram.
			const grams = subanagramTargets(value);
			if (grams.length === 0) return null;
			// Alphagrams are [A-Z] only, so inline them as literals: a blanked rack can
			// produce more targets than SQLite allows as bound parameters.
			const inList = grams.map((g) => `'${g}'`).join(', ');
			return { sql: `alphagram IN (${inList})`, params: [] };
		}
		case 'includeLetters': {
			const counts = letterCounts(value.replace(/[?*]/g, ''));
			if (counts.size === 0) return null;
			// Exclude: contain none of these letters. Include: contain at least n of
			// each — "*E*E*" matches two E's anywhere. Both are pure SQL (GLOB), so
			// membership is decided entirely in the query, multiplicity included.
			if (not) {
				return {
					sql: [...counts.keys()].map(() => 'word NOT GLOB ?').join(' AND '),
					params: [...counts.keys()].map((letter) => `*${letter}*`)
				};
			}
			return {
				sql: [...counts.keys()].map(() => 'word GLOB ?').join(' AND '),
				params: [...counts].map(([letter, n]) => '*' + `${letter}*`.repeat(n))
			};
		}
		case 'definition': {
			if (!condition.value.trim()) return null;
			const needle = condition.value.trim().toLowerCase();
			return { sql: `(instr(lower(definition), ?) > 0) ${not ? '= 0' : '= 1'}`, params: [needle] };
		}
		case 'partOfSpeech': {
			const pos = condition.value.trim().toLowerCase();
			if (!pos) return null;
			return {
				sql: `(instr(',' || part_of_speech || ',', ?) > 0) ${not ? '= 0' : '= 1'}`,
				params: [`,${pos},`]
			};
		}
	}
}

// A rack search ("anagram", "subanagram") treats "?" as a blank standing for any
// one letter, and "*" as any number of blanks. Realistic racks hold at most two
// "?" blanks; cap there so a blank-heavy query can't blow up the enumeration. "*"
// is unbounded but is expressed as a length comparison, so it needs no cap.
const MAX_BLANKS = 2;

/**
 * Split a rack into its A–Z fixed letters, its (capped) count of "?" blanks, and
 * whether a "*" (any number of blanks) is present.
 */
function splitRack(value: string): { fixed: string; blanks: number; open: boolean } {
	let fixed = '';
	let blanks = 0;
	let open = false;
	for (const ch of value) {
		if (ch === '?') blanks++;
		else if (ch === '*') open = true;
		else if (ch >= 'A' && ch <= 'Z') fixed += ch;
	}
	return { fixed, blanks: Math.min(blanks, MAX_BLANKS), open };
}

/** Every length-`n` multiset of the alphabet, each as a sorted letter string. */
function letterMultisets(n: number): string[] {
	const out: string[] = [];
	const build = (start: number, acc: string) => {
		if (acc.length === n) {
			out.push(acc);
			return;
		}
		for (let i = start; i < ALPHABET.length; i++) build(i, acc + ALPHABET[i]);
	};
	build(0, '');
	return out;
}

/** Sub-multiset alphagrams of a rack, with each "?" filled by any one letter. */
function subanagramTargets(value: string): string[] {
	const { fixed, blanks } = splitRack(value);
	if (blanks === 0) return subAlphagrams(fixed);
	const grams = new Set<string>();
	for (const fill of letterMultisets(blanks)) {
		for (const gram of subAlphagrams(fixed + fill)) grams.add(gram);
	}
	return [...grams];
}

/** Every non-empty sub-multiset of `letters`, as alphagrams (letters sorted). */
function subAlphagrams(letters: string): string[] {
	const counts = letterCounts(letters);
	const distinct = [...counts.keys()].sort();

	const grams: string[] = [];
	const build = (index: number, acc: string) => {
		if (index === distinct.length) {
			if (acc) grams.push(acc);
			return;
		}
		const letter = distinct[index];
		for (let k = 0; k <= counts.get(letter)!; k++) build(index + 1, acc + letter.repeat(k));
	};
	build(0, '');
	return grams;
}

/**
 * An ordered window over matched words. Holds only the (cheap) ordered word
 * strings; full entries are hydrated on demand for the requested slice and
 * cached, so scrolling a huge result set never materialises rows off-screen.
 */
class WordList implements WordWindow {
	private readonly cache = new Map<string, WordEntry>();

	constructor(
		readonly words: string[],
		private readonly hydrate: (words: string[]) => WordEntry[]
	) {}

	get length(): number {
		return this.words.length;
	}

	slice(start: number, end: number): WordEntry[] {
		const window = this.words.slice(start, end);
		const missing = window.filter((w) => !this.cache.has(w));
		if (missing.length > 0) {
			for (const entry of this.hydrate(missing)) this.cache.set(entry.word, entry);
		}
		return window.map((w) => this.cache.get(w)!);
	}
}

export class SqliteLexiconEngine implements LexiconEngine {
	constructor(
		readonly name: string,
		private readonly db: Database
	) {}

	isValid(word: string): boolean {
		return this.db.selectValue('SELECT 1 FROM words WHERE word = ?', [word.toUpperCase()]) !== undefined;
	}

	lookup(word: string): WordEntry | undefined {
		const row = this.db.selectObject(`SELECT ${COLUMNS} FROM words WHERE word = ?`, [word.toUpperCase()]);
		return row ? rowToEntry(row) : undefined;
	}

	anagrams(letters: string): WordEntry[] {
		const rows = this.db.selectObjects(
			`SELECT ${COLUMNS} FROM words WHERE alphagram = ? ORDER BY probability_order0`,
			[alphagram(letters.toUpperCase())]
		);
		return rows.map(rowToEntry);
	}

	search(spec: SearchSpec): SearchResult {
		const compiled = spec.conditions
			.map(compileCondition)
			.filter((c): c is CompiledClause => c !== null);
		if (compiled.length === 0) {
			return {
				words: new WordList([], () => []),
				columns: { word: 0, frontHooks: 0, backHooks: 0 },
				capped: false
			};
		}

		const where = compiled.map((c) => `(${c.sql})`).join(' AND ');
		const params = compiled.flatMap((c) => c.params);

		// Every condition is decided in SQL, so the query is authoritative: fetch
		// one past the limit to learn whether more matched. Only the ordered word
		// strings are pulled here — full rows hydrate lazily per visible slice.
		const sqlLimit = spec.limit !== undefined ? ` LIMIT ${spec.limit + 1}` : '';
		let words = this.db
			.selectObjects(
				`SELECT word FROM words WHERE ${where} ORDER BY ${orderClause(spec.sort)}${sqlLimit}`,
				params
			)
			.map((r) => r.word as string);

		const capped = spec.limit !== undefined && words.length > spec.limit;
		if (capped) words = words.slice(0, spec.limit);

		const columns = this.columnWidths(where, params);
		return { words: new WordList(words, (batch) => this.entriesFor(batch)), columns, capped };
	}

	/** Widest word and hook strings among matches, to size table columns without
	 * truncating them. */
	private columnWidths(where: string, params: SqlValue[]): ColumnWidths {
		const row = this.db.selectObject(
			`SELECT MAX(LENGTH(word)) w, MAX(LENGTH(front_hooks)) f, MAX(LENGTH(back_hooks)) b
			 FROM words WHERE ${where}`,
			params
		);
		return {
			word: (row?.w as number) ?? 0,
			frontHooks: (row?.f as number) ?? 0,
			backHooks: (row?.b as number) ?? 0
		};
	}

	/** Full entries for an explicit set of words (unordered; the caller re-orders). */
	private entriesFor(words: string[]): WordEntry[] {
		if (words.length === 0) return [];
		const holes = words.map(() => '?').join(', ');
		return this.db
			.selectObjects(`SELECT ${COLUMNS} FROM words WHERE word IN (${holes})`, words)
			.map(rowToEntry);
	}
}
