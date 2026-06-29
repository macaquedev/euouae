// The single source of truth for what a "word" is in this app. Mirrors the
// precomputed columns of Zyzzyva's lexicon DB so we never recompute
// correctness-critical data at runtime — the lexicon is a read-only oracle.

/** Blanks assumed in the bag when ranking a word by draw probability. */
export type BlankCount = 0 | 1 | 2;

/** A per-blank-count value (probability uses three parallel rankings). */
export type ByBlanks = Readonly<Record<BlankCount, number>>;

export interface WordEntry {
	readonly word: string;
	readonly length: number;
	/** Letters sorted ascending: the key that groups anagrams together. */
	readonly alphagram: string;
	readonly pointValue: number;

	readonly numAnagrams: number;
	readonly numUniqueLetters: number;
	readonly numVowels: number;

	/** Letters that make a valid word when placed before this one. */
	readonly frontHooks: string;
	/** Letters that make a valid word when placed after this one. */
	readonly backHooks: string;
	/** This word is itself the front hook of some longer word. */
	readonly isFrontHook: boolean;
	readonly isBackHook: boolean;

	/**
	 * Empirical play frequency from real-game corpora. Sourced from a separate
	 * playability list and absent for words it doesn't cover, hence nullable.
	 */
	readonly playability: number | null;
	/** Rank within this length by playability, 1 = most played; null if absent. */
	readonly playabilityOrder: number | null;

	/**
	 * Ways to draw this word's tiles, indexed by blanks assumed in the bag.
	 * Computed by the build pipeline from the tile distribution; null until that
	 * pass runs.
	 */
	readonly combinations: ByBlanks | null;
	/** Rank within this length by `combinations`, 1 = most probable; null if absent. */
	readonly probabilityOrder: ByBlanks | null;

	/** Part-of-speech tags parsed from the definition, e.g. ["n", "v"]. */
	readonly partOfSpeech: readonly string[];
	/** Definition text, including inflection/POS brackets. "" if unknown. */
	readonly definition: string;
}

/** Numeric columns a search can bound with an inclusive [min, max] range. */
export type RangeField =
	| 'length'
	| 'numVowels'
	| 'numUniqueLetters'
	| 'pointValue'
	| 'numAnagrams'
	| 'probabilityOrder';

/** Text-valued conditions; `value` interpretation depends on `type`. */
export type StringField =
	| 'pattern' // GLOB pattern: ? = any one letter, * = any run, [AEIOU] = class
	| 'anagram' // exact anagram of the letters ("?" = one blank, "*" = any number)
	| 'subanagram' // formable from a subset of the letters ("?" = blank)
	| 'includeLetters' // contains these letters (multiset; respects repeats)
	| 'definition' // substring of the definition text
	| 'partOfSpeech'; // tagged with this part of speech, e.g. "n"

/** One clause of a search. All clauses in a spec are combined with AND. */
export type SearchCondition =
	| { kind: 'range'; type: RangeField; min: number; max: number }
	| { kind: 'string'; type: StringField; value: string; negated: boolean };

/** A sortable result column (maps to a table header the user can click). */
export type SortColumn = 'word' | 'length' | 'pointValue' | 'probability';
export type SortDirection = 'asc' | 'desc';

export interface SearchSort {
	readonly column: SortColumn;
	readonly direction: SortDirection;
}

export interface SearchSpec {
	readonly conditions: readonly SearchCondition[];
	readonly sort: SearchSort;
	/** Max rows to return; omit for the full result set. */
	readonly limit?: number;
}

/**
 * The matched words as a lazily-hydrated, ordered window. `words` is the full
 * ordered list of matched word strings (cheap, for counting/exporting); full
 * `WordEntry` rows are fetched only for the slice a view actually displays.
 */
export interface WordWindow {
	readonly length: number;
	readonly words: readonly string[];
	/** Full entries for the ordered slice [start, end), built on demand. */
	slice(start: number, end: number): WordEntry[];
}

/** Widest content (in characters) per variable column, to size a table so the
 * word column aligns and hooks are never truncated. Zero when no matches. */
export interface ColumnWidths {
	readonly word: number;
	readonly frontHooks: number;
	readonly backHooks: number;
}

export interface SearchResult {
	readonly words: WordWindow;
	readonly columns: ColumnWidths;
	/** True when `limit` was set and more words matched than it. */
	readonly capped: boolean;
}

/**
 * The one query surface that Judge, Word Info, Search, and Quiz all sit on.
 * Implementations wrap a single lexicon; the app may hold several at once.
 */
export interface LexiconEngine {
	/** Lexicon identifier, e.g. "CSW24". */
	readonly name: string;

	/** Judge primitive: is this exact word valid? Must be fast and infallible. */
	isValid(word: string): boolean;

	/** Word Info primitive: full entry, or undefined if not in the lexicon. */
	lookup(word: string): WordEntry | undefined;

	/** All valid words that are exact anagrams of `letters` (blanks: "?"). */
	anagrams(letters: string): WordEntry[];

	/** Run a multi-condition search (clauses AND-combined). */
	search(spec: SearchSpec): SearchResult;
}
