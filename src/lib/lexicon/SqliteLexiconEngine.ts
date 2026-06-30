// LexiconEngine backed by a read-only SQLite-WASM database. All queries go
// through here, so the rest of the app never writes SQL or touches column names.

import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { bool, num, numOrNull, str } from '$lib/sqlite/values';
import type { Alphabet, Tile } from './alphabet';
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

function rowToEntry(alphabet: Alphabet, r: Row): WordEntry {
	const pos = str(r.part_of_speech);
	return {
		word: str(r.word),
		length: num(r.length),
		alphagram: str(r.alphagram),
		pointValue: num(r.point_value),
		numAnagrams: num(r.num_anagrams),
		numUniqueLetters: num(r.num_unique_letters),
		numVowels: num(r.num_vowels),
		// front_hooks/back_hooks are stored encoded (one code point per tile, like
		// `tiles`), so decode to separate glyphs rather than a joined string.
		frontHooks: alphabet.decodeToGlyphs(str(r.front_hooks)),
		backHooks: alphabet.decodeToGlyphs(str(r.back_hooks)),
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

/** Per-glyph occurrence counts of tokenized tiles, e.g. [E,E,N] -> {E:2, N:1}. */
function tileCounts(tiles: readonly Tile[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const t of tiles) counts.set(t.glyph, (counts.get(t.glyph) ?? 0) + 1);
	return counts;
}

/** Translate one condition into a SQL fragment + bound params, or null if empty. */
interface CompiledClause {
	sql: string;
	params: SqlValue[];
}

// A rack search ("anagram", "subanagram") treats "?" as a blank standing for any
// one tile, and "[...]" as a restricted choice among several tiles — each is
// one wild slot needing enumeration. Cap how many a query can have, so a
// wildcard-heavy rack can't blow up the enumeration; covers Zyzzyva's own
// documented examples (e.g. two "[...]" classes, as in "Z[AEIOU][AEIOU]") with
// room for blanks alongside them. "*" is unbounded but is expressed as a
// length comparison, so it needs no cap.
const MAX_WILD_SLOTS = 4;

function compileCondition(alphabet: Alphabet, condition: SearchCondition): CompiledClause | null {
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
			// Matched against the encoded `tiles` column (one code point per tile), so
			// "?" means one tile and a multi-character glyph like Spanish "CH" is a
			// single match unit, never its component letters.
			const encoded = alphabet.encodePattern(value);
			return { sql: not ? 'tiles NOT GLOB ?' : 'tiles GLOB ?', params: [encoded] };
		}
		case 'anagram': {
			// "?" is one blank (any tile) and "[...]" is a restricted choice (any
			// tile from that set) — both are exactly one slot, matching Zyzzyva's
			// Anagram Match wildcards. No wildcards at all keeps the fast,
			// index-backed alphagram lookup; a closed (non-"*") rack with wildcards
			// enumerates every way to fill them into an exact-alphagram IN-list,
			// same strategy as `subanagram` below. "*" makes the rack open-ended —
			// any number of further tiles beyond what's specified — which can't be
			// enumerated by length, so it falls back to a length/GLOB query.
			const { slots, open } = alphabet.tokenizeRack(value);
			if (slots.length === 0 && !open) return null;

			if (!open) {
				const grams = alphabet.anagramAlphagrams(value, MAX_WILD_SLOTS);
				if (!grams || grams.length === 0) return null;
				const inList = grams.map((g) => `'${g}'`).join(', ');
				return { sql: `alphagram IN (${inList})`, params: [] };
			}

			const fixed = slots.filter((s) => s.kind === 'tile').map((s) => s.tile);
			const clauses = ['length >= ?'];
			const params: SqlValue[] = [slots.length];
			for (const [glyph, n] of tileCounts(fixed)) {
				clauses.push('tiles GLOB ?');
				const code = alphabet.encodeGlyph(glyph)!;
				params.push('*' + `${code}*`.repeat(n));
			}
			// Group identical classes together, so "Z[AEIOU][AEIOU]*" requires two
			// distinct vowel occurrences (one glob match point per "[...]"), not
			// the same one twice.
			const classGroups = new Map<string, number>();
			for (const slot of slots) {
				if (slot.kind !== 'class') continue;
				const codes = slot.choices
					.map((t) => alphabet.encodeGlyph(t.glyph)!)
					.sort()
					.join('');
				classGroups.set(codes, (classGroups.get(codes) ?? 0) + 1);
			}
			for (const [codes, n] of classGroups) {
				clauses.push('tiles GLOB ?');
				params.push('*' + `[${codes}]*`.repeat(n));
			}
			return { sql: clauses.join(' AND '), params };
		}
		case 'subanagram': {
			// Each "?" or "[...]" is a wild slot that may stand for any matching
			// tile or go unused. "*" is ignored here: unlimited extra tiles would
			// make every word a subanagram.
			const grams = alphabet.subanagramAlphagrams(value, MAX_WILD_SLOTS);
			if (grams.length === 0) return null;
			// Alphagrams are tile glyphs only (no quotes), so inline them as literals:
			// a wildcard-heavy rack can produce more targets than SQLite allows as
			// bound parameters.
			const inList = grams.map((g) => `'${g}'`).join(', ');
			return { sql: `alphagram IN (${inList})`, params: [] };
		}
		case 'includeLetters': {
			// Zyzzyva's IncludeLetters takes the search text completely literally —
			// no "?"/"*"/"[...]" wildcard meaning — so this uses plain `tokenize`,
			// not the rack parser the other conditions use.
			const tiles = alphabet.tokenize(value);
			const counts = tileCounts(tiles);
			if (counts.size === 0) return null;
			// Exclude: contain none of these tiles. Include: contain at least n of
			// each — "*E*E*" matches two E's anywhere. Both are pure SQL (GLOB) over
			// the encoded `tiles` column, so membership is decided entirely in the
			// query, multiplicity and tile boundaries both respected.
			if (not) {
				return {
					sql: [...counts.keys()].map(() => 'tiles NOT GLOB ?').join(' AND '),
					params: [...counts.keys()].map((glyph) => `*${alphabet.encodeGlyph(glyph)}*`)
				};
			}
			return {
				sql: [...counts.keys()].map(() => 'tiles GLOB ?').join(' AND '),
				params: [...counts].map(([glyph, n]) => '*' + `${alphabet.encodeGlyph(glyph)}*`.repeat(n))
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
		private readonly db: Database,
		readonly alphabet: Alphabet
	) {}

	isValid(word: string): boolean {
		return this.db.selectValue('SELECT 1 FROM words WHERE word = ?', [word.toUpperCase()]) !== undefined;
	}

	lookup(word: string): WordEntry | undefined {
		const row = this.db.selectObject(`SELECT ${COLUMNS} FROM words WHERE word = ?`, [word.toUpperCase()]);
		return row ? rowToEntry(this.alphabet, row) : undefined;
	}

	anagrams(letters: string): WordEntry[] {
		const rows = this.db.selectObjects(
			`SELECT ${COLUMNS} FROM words WHERE alphagram = ? ORDER BY probability_order0`,
			[this.alphabet.alphagram(letters.toUpperCase())]
		);
		return rows.map((r) => rowToEntry(this.alphabet, r));
	}

	search(spec: SearchSpec): SearchResult {
		const compiled = spec.conditions
			.map((c) => compileCondition(this.alphabet, c))
			.filter((c): c is CompiledClause => c !== null);
		if (compiled.length === 0) {
			return {
				words: new WordList([], () => []),
				columns: { word: 0, frontHooks: 0, backHooks: 0 },
				capped: false,
				hookChars: []
			};
		}

		const where = compiled.map((c) => `(${c.sql})`).join(' AND ');
		// A clause like "subanagram" inlines its values as SQL literals rather than
		// binding them (see compileCondition), so `params` can end up empty even
		// though `where` is non-trivial. sqlite-wasm rejects a non-empty bind array
		// for a statement with zero "?" placeholders, so pass undefined instead of
		// an empty array — never an empty array on a paramless query.
		const allParams = compiled.flatMap((c) => c.params);
		const params = allParams.length > 0 ? allParams : undefined;

		// Every condition is decided in SQL, so the query is authoritative: fetch
		// one past the limit to learn whether more matched. Only the ordered word
		// strings (plus each row's cheap hook *lengths*, for per-row layout — see
		// `hookChars`) are pulled here; full rows still hydrate lazily per slice.
		const sqlLimit = spec.limit !== undefined ? ` LIMIT ${spec.limit + 1}` : '';
		const rows = this.db.selectObjects(
			`SELECT word, LENGTH(front_hooks) fh, LENGTH(back_hooks) bh FROM words
			 WHERE ${where} ORDER BY ${orderClause(spec.sort)}${sqlLimit}`,
			params
		);
		let words = rows.map((r) => r.word as string);
		let hookChars = rows.map((r) =>
			this.hookWidth(Math.max(r.fh as number, r.bh as number))
		);

		const capped = spec.limit !== undefined && words.length > spec.limit;
		if (capped) {
			words = words.slice(0, spec.limit);
			hookChars = hookChars.slice(0, spec.limit);
		}

		const columns = this.columnWidths(where, params);
		return {
			words: new WordList(words, (batch) => this.entriesFor(batch)),
			columns,
			capped,
			hookChars
		};
	}

	// front_hooks/back_hooks are stored encoded, so LENGTH() counts tiles, not
	// display characters. For a single-character alphabet (the common case)
	// that's already the exact display width. A multi-character alphabet joins
	// its glyphs with a separator for display (see joinHooks), so size for the
	// worst case: every tile at the widest glyph, plus its separator.
	private hookWidth(tileCount: number): number {
		return this.alphabet.hasMultiCharTiles ? tileCount * (this.alphabet.maxGlyphLength + 1) : tileCount;
	}

	/** Widest word and hook strings among matches, to size table columns without
	 * truncating them. */
	private columnWidths(where: string, params: SqlValue[] | undefined): ColumnWidths {
		const row = this.db.selectObject(
			`SELECT MAX(LENGTH(word)) w, MAX(LENGTH(front_hooks)) f, MAX(LENGTH(back_hooks)) b
			 FROM words WHERE ${where}`,
			params
		);
		return {
			word: (row?.w as number) ?? 0,
			frontHooks: this.hookWidth((row?.f as number) ?? 0),
			backHooks: this.hookWidth((row?.b as number) ?? 0)
		};
	}

	/** Full entries for an explicit set of words (unordered; the caller re-orders). */
	private entriesFor(words: string[]): WordEntry[] {
		if (words.length === 0) return [];
		const holes = words.map(() => '?').join(', ');
		return this.db
			.selectObjects(`SELECT ${COLUMNS} FROM words WHERE word IN (${holes})`, words)
			.map((r) => rowToEntry(this.alphabet, r));
	}
}
