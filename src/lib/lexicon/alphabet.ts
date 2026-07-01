// A lexicon's tile set: the single source of how its words break into tiles and
// what each tile is worth. Everything letter-shaped — alphagrams, point values,
// vowel/length counts, hooks, draw probability — is derived from one of these,
// so adding a language is a new Alphabet, not a new branch through the code.
//
// Tiles are listed in collation order. A tile's glyph may be more than one
// character (Spanish CH/LL/RR), so a word is split by longest-match tokenization,
// never by `[...word]`. Collation is therefore the tile order defined here, not
// the host's Unicode/locale order — deterministic across machines and builds.

export interface Tile {
	/** Uppercase display form: "A", "CH", "Ä". One tile, even if multi-character. */
	readonly glyph: string;
	readonly value: number;
	/** Count in a full bag — drives draw probability. */
	readonly frequency: number;
	readonly vowel: boolean;
}

export interface AlphabetSpec {
	readonly name: string;
	/** Tiles in collation order — the order alphagrams sort by. */
	readonly tiles: readonly Tile[];
	readonly blankCount: number;
}

/** One slot of a parsed rack search string (see `Alphabet.tokenizeRack`): a
 *  specific tile, a fully-open blank ("?", any one tile), or a restricted
 *  choice among several tiles (a "[...]" class, or its negation "[^...]"). */
export type RackSlot =
	| { readonly kind: 'tile'; readonly tile: Tile }
	| { readonly kind: 'blank' }
	| { readonly kind: 'class'; readonly choices: readonly Tile[] };

export interface TokenizedRack {
	readonly slots: readonly RackSlot[];
	/** Whether the rack ends open ("*"): any number of further tiles allowed. */
	readonly open: boolean;
}

// Multi-character and non-ASCII tiles are re-encoded to a single private-use code
// point so the database can store one code point per tile: then SQLite's GLOB `?`
// means "one tile", a word's tile length is its string length, and patterns line
// up. A plain A–Z tile encodes to itself, so an all-ASCII lexicon (English) is
// encoded identically to its display form — no migration, byte-identical data.
const ENCODE_BASE = 0xe000;

export class Alphabet {
	readonly name: string;
	readonly tiles: readonly Tile[];
	readonly blankCount: number;
	/** Length, in characters, of the longest tile glyph — drives tokenization. */
	readonly maxGlyphLength: number;
	/** True when any tile's glyph is more than one character (e.g. Spanish "CH").
	 *  Display code joins such an alphabet's glyphs with a separator; a single-
	 *  character alphabet (English, French, German's Ä/Ö/Ü) never needs one. */
	readonly hasMultiCharTiles: boolean;
	private readonly orderByGlyph = new Map<string, number>();
	private readonly tileByGlyph = new Map<string, Tile>();
	private readonly codeByGlyph = new Map<string, string>();
	private readonly glyphByCode = new Map<string, string>();

	constructor(spec: AlphabetSpec) {
		this.name = spec.name;
		this.tiles = spec.tiles;
		this.blankCount = spec.blankCount;
		this.maxGlyphLength = Math.max(...spec.tiles.map((t) => t.glyph.length));
		this.hasMultiCharTiles = this.maxGlyphLength > 1;
		spec.tiles.forEach((tile, order) => {
			this.orderByGlyph.set(tile.glyph, order);
			this.tileByGlyph.set(tile.glyph, tile);
			const code = /^[A-Z]$/.test(tile.glyph) ? tile.glyph : String.fromCodePoint(ENCODE_BASE + order);
			this.codeByGlyph.set(tile.glyph, code);
			this.glyphByCode.set(code, tile.glyph);
		});
	}

	/** Split an uppercased word into its tiles by longest-match; unknown characters
	 *  are skipped. Lenient on purpose — for typed query input (an anagram rack, a
	 *  pattern) a stray character should be ignored, not reject the whole query.
	 *  A *lexicon* word list must not rely on this leniency: see `tokenizeStrict`,
	 *  which is what validates a word actually belongs to a given alphabet. */
	tokenize(word: string): Tile[] {
		const tiles: Tile[] = [];
		for (let i = 0; i < word.length; ) {
			let matched: Tile | undefined;
			for (let len = Math.min(this.maxGlyphLength, word.length - i); len >= 1; len--) {
				matched = this.tileByGlyph.get(word.slice(i, i + len));
				if (matched) break;
			}
			if (matched) {
				tiles.push(matched);
				i += matched.glyph.length;
			} else {
				i += 1;
			}
		}
		return tiles;
	}

	/**
	 * Tokenize `word` strictly: its tiles if every character belongs to one,
	 * otherwise `null`. A lexicon word list must pass this before being built —
	 * `tokenize`'s silent skipping would otherwise let a word with a character
	 * outside the alphabet (e.g. an English "AAK" fed to a Spanish tile set with
	 * no K) quietly collapse into a different, shorter word ("AA") instead of
	 * being rejected.
	 */
	tokenizeStrict(word: string): Tile[] | null {
		const tiles: Tile[] = [];
		for (let i = 0; i < word.length; ) {
			let matched: Tile | undefined;
			for (let len = Math.min(this.maxGlyphLength, word.length - i); len >= 1; len--) {
				matched = this.tileByGlyph.get(word.slice(i, i + len));
				if (matched) break;
			}
			if (!matched) return null;
			tiles.push(matched);
			i += matched.glyph.length;
		}
		return tiles;
	}

	/** Tiles sorted into collation order, glyphs joined — the anagram key. */
	alphagram(word: string): string {
		return this.alphagramOfTiles(this.tokenize(word));
	}

	/** Same as `alphagram`, but for tiles already in hand — never round-trip
	 *  through display text, since concatenating glyphs can retokenize wrong
	 *  (e.g. lone "C" + "H" tiles would read back as one "CH" tile). */
	alphagramOfTiles(tiles: readonly Tile[]): string {
		return [...tiles]
			.sort((a, b) => this.orderByGlyph.get(a.glyph)! - this.orderByGlyph.get(b.glyph)!)
			.map((t) => t.glyph)
			.join('');
	}

	/**
	 * Parse a rack search string into its slots, by longest-match tokenization —
	 * so a multi-character tile glyph in the rack (e.g. Spanish "CH") is read as
	 * one tile, not its component characters. A slot is a fixed tile, a "?"
	 * (a blank: any one tile), or a "[...]"/"[^...]" class (any one tile from —
	 * or, negated, outside — that set), matching Zyzzyva's Anagram/Subanagram
	 * Match wildcards. "*" sets `open` instead of becoming a slot: it means "any
	 * number of further tiles", not one specific tile. Unmatched characters are
	 * skipped, same as `tokenize`.
	 */
	tokenizeRack(value: string): TokenizedRack {
		const slots: RackSlot[] = [];
		let open = false;
		for (let i = 0; i < value.length; ) {
			const ch = value[i];
			if (ch === '?') {
				slots.push({ kind: 'blank' });
				i++;
				continue;
			}
			if (ch === '*') {
				open = true;
				i++;
				continue;
			}
			if (ch === '[') {
				const close = value.indexOf(']', i + 1);
				if (close === -1) {
					i++;
					continue;
				}
				let j = i + 1;
				let negated = false;
				if (value[j] === '^') {
					negated = true;
					j++;
				}
				const members = new Set<string>();
				while (j < close) {
					let matched: Tile | undefined;
					for (let len = Math.min(this.maxGlyphLength, close - j); len >= 1; len--) {
						matched = this.tileByGlyph.get(value.slice(j, j + len));
						if (matched) break;
					}
					if (matched) {
						members.add(matched.glyph);
						j += matched.glyph.length;
					} else {
						j++;
					}
				}
				const choices = this.tiles.filter((t) => members.has(t.glyph) !== negated);
				if (choices.length > 0) slots.push({ kind: 'class', choices });
				i = close + 1;
				continue;
			}
			let matched: Tile | undefined;
			for (let len = Math.min(this.maxGlyphLength, value.length - i); len >= 1; len--) {
				matched = this.tileByGlyph.get(value.slice(i, i + len));
				if (matched) break;
			}
			if (matched) {
				slots.push({ kind: 'tile', tile: matched });
				i += matched.glyph.length;
			} else {
				i += 1;
			}
		}
		return { slots, open };
	}

	/** Every non-empty sub-multiset of `tiles`, as collation-sorted alphagrams. */
	private subAlphagramsOf(tiles: readonly Tile[]): string[] {
		const counts = new Map<string, number>();
		for (const t of tiles) counts.set(t.glyph, (counts.get(t.glyph) ?? 0) + 1);
		const distinct = [...counts.keys()].sort(
			(a, b) => this.orderByGlyph.get(a)! - this.orderByGlyph.get(b)!
		);

		const grams: string[] = [];
		const build = (index: number, acc: string) => {
			if (index === distinct.length) {
				if (acc) grams.push(acc);
				return;
			}
			const glyph = distinct[index];
			for (let k = 0; k <= counts.get(glyph)!; k++) build(index + 1, acc + glyph.repeat(k));
		};
		build(0, '');
		return grams;
	}

	/** Every way to resolve a sequence of wild slots (blank or class) to one
	 *  tile each — the cartesian product of each slot's choices ("?" = every
	 *  tile in the alphabet, "[...]" = just that class's members). */
	private wildChoices(slots: readonly RackSlot[]): Tile[][] {
		let combos: Tile[][] = [[]];
		for (const slot of slots) {
			const options = slot.kind === 'class' ? slot.choices : this.tiles;
			const next: Tile[][] = [];
			for (const combo of combos) for (const opt of options) next.push([...combo, opt]);
			combos = next;
		}
		return combos;
	}

	/**
	 * Sub-multiset alphagrams of a rack search string, with each wild slot
	 * ("?" or "[...]") filled by one of its possible tiles (capped at
	 * `maxWild` slots, since a wildcard-heavy rack can otherwise blow up the
	 * enumeration). "*" is ignored: unlimited extra tiles would make every word
	 * a subanagram.
	 */
	subanagramAlphagrams(value: string, maxWild: number): string[] {
		const { slots } = this.tokenizeRack(value);
		const fixed = slots.filter((s) => s.kind === 'tile').map((s) => s.tile);
		const wild = slots.filter((s) => s.kind !== 'tile').slice(0, maxWild);
		if (wild.length === 0) return this.subAlphagramsOf(fixed);
		const grams = new Set<string>();
		for (const combo of this.wildChoices(wild)) {
			for (const gram of this.subAlphagramsOf([...fixed, ...combo])) grams.add(gram);
		}
		return [...grams];
	}

	/**
	 * Exact-anagram alphagrams of a rack search string, with each wild slot
	 * ("?" or "[...]") filled by one of its possible tiles (capped at
	 * `maxWild` slots — see `subanagramAlphagrams`), deduplicated. Returns
	 * `null` if the rack ends open ("*"): an open-ended anagram has no fixed
	 * length to enumerate against, so the caller should fall back to a
	 * length/GLOB query instead.
	 */
	anagramAlphagrams(value: string, maxWild: number): string[] | null {
		const { slots, open } = this.tokenizeRack(value);
		if (open) return null;
		const fixed = slots.filter((s) => s.kind === 'tile').map((s) => s.tile);
		const wild = slots.filter((s) => s.kind !== 'tile').slice(0, maxWild);
		if (wild.length === 0) return [this.alphagramOfTiles(fixed)];
		const grams = new Set<string>();
		for (const combo of this.wildChoices(wild)) {
			grams.add(this.alphagramOfTiles([...fixed, ...combo]));
		}
		return [...grams];
	}

	/**
	 * Translate a GLOB pattern written in display glyphs (supporting "?" = one
	 * tile, "*" = any run of tiles, and "[...]" classes) into the same pattern
	 * over encoded tile code points, so SQLite's GLOB matches per-tile rather
	 * than per-character. A "[...]" class lists individual single-character
	 * glyphs, translated member by member. Anything unrecognised passes through
	 * unchanged, so a typo still round-trips instead of vanishing.
	 */
	encodePattern(pattern: string): string {
		let out = '';
		for (let i = 0; i < pattern.length; ) {
			const ch = pattern[i];
			if (ch === '?' || ch === '*') {
				out += ch;
				i++;
				continue;
			}
			if (ch === '[') {
				const close = pattern.indexOf(']', i + 1);
				if (close === -1) {
					out += ch;
					i++;
					continue;
				}
				out += '[';
				let j = i + 1;
				if (pattern[j] === '^' || pattern[j] === '!') {
					out += pattern[j];
					j++;
				}
				for (; j < close; j++) out += this.codeByGlyph.get(pattern[j]) ?? pattern[j];
				out += ']';
				i = close + 1;
				continue;
			}
			let matched: string | undefined;
			let matchedLen = 0;
			for (let len = Math.min(this.maxGlyphLength, pattern.length - i); len >= 1; len--) {
				const code = this.codeByGlyph.get(pattern.slice(i, i + len));
				if (code) {
					matched = code;
					matchedLen = len;
					break;
				}
			}
			if (matched) {
				out += matched;
				i += matchedLen;
			} else {
				out += ch;
				i++;
			}
		}
		return out;
	}

	/**
	 * Parse a "Consist Of" spec into a per-tile cap: a run of tile glyphs, each
	 * optionally followed by digits capping how many of that tile the word may
	 * contain (`null` = unlimited if no digits follow, e.g. "AEIOU" allows any
	 * count of each; "A2E1" allows up to 2 A's and 1 E). Tiles not present in the
	 * map are forbidden entirely — that's the "consist of only these" semantics.
	 * Longest-match tokenized like `tokenizeRack`, so a multi-character tile
	 * glyph (e.g. Spanish "CH") reads as one tile before its digits.
	 */
	consistOfCaps(value: string): Map<string, number | null> {
		const caps = new Map<string, number | null>();
		for (let i = 0; i < value.length; ) {
			let matched: Tile | undefined;
			for (let len = Math.min(this.maxGlyphLength, value.length - i); len >= 1; len--) {
				matched = this.tileByGlyph.get(value.slice(i, i + len));
				if (matched) break;
			}
			if (!matched) {
				i++;
				continue;
			}
			i += matched.glyph.length;
			let digits = '';
			while (i < value.length && /[0-9]/.test(value[i])) {
				digits += value[i];
				i++;
			}
			caps.set(matched.glyph, digits ? Number(digits) : null);
		}
		return caps;
	}

	/** Sum of tile values for the word. */
	pointValue(word: string): number {
		return this.tokenize(word).reduce((sum, t) => sum + t.value, 0);
	}

	/** Count of vowel tiles in the word. */
	vowelCount(word: string): number {
		return this.tokenize(word).filter((t) => t.vowel).length;
	}

	/** Number of distinct tiles in the word. */
	uniqueTileCount(word: string): number {
		return new Set(this.tokenize(word).map((t) => t.glyph)).size;
	}

	/** Number of tiles in the word (its length in the game, not in characters). */
	tileCount(word: string): number {
		return this.tokenize(word).length;
	}

	/**
	 * Tiles that form a valid word when prepended to `word`, in collation order.
	 * Returned as separate glyphs, never joined into one string: a joined "CHLL"
	 * is ambiguous (two single tiles "C","H" vs. two digraphs "CH","LL") and, worse,
	 * relexes wrong if anyone re-tokenizes it. Callers decide how to display them.
	 */
	frontHooks(word: string, isWord: (w: string) => boolean): string[] {
		return this.tiles.filter((t) => isWord(t.glyph + word)).map((t) => t.glyph);
	}

	/** Tiles that form a valid word when appended to `word`, in collation order. */
	backHooks(word: string, isWord: (w: string) => boolean): string[] {
		return this.tiles.filter((t) => isWord(word + t.glyph)).map((t) => t.glyph);
	}

	/** Re-encode a word to one code point per tile (the stored, searchable form). */
	encode(word: string): string {
		return this.tokenize(word)
			.map((t) => this.codeByGlyph.get(t.glyph)!)
			.join('');
	}

	/** The single encoded code point for one tile glyph (for building patterns). */
	encodeGlyph(glyph: string): string | undefined {
		return this.codeByGlyph.get(glyph);
	}

	/** Encode a list of glyphs (e.g. from `frontHooks`/`backHooks`) to one code
	 *  point per tile — the same storage form `encode` produces for a word. */
	encodeGlyphs(glyphs: readonly string[]): string {
		return glyphs.map((g) => this.codeByGlyph.get(g)!).join('');
	}

	/** Turn an encoded string back into its display glyphs, joined. Ambiguous for
	 *  multi-character tiles (see `frontHooks`) — prefer `decodeToGlyphs`. */
	decode(encoded: string): string {
		return [...encoded].map((code) => this.glyphByCode.get(code) ?? code).join('');
	}

	/** Turn an encoded string back into its individual display glyphs, kept
	 *  separate so a multi-character tile (e.g. Spanish "CH") can't be confused
	 *  with two single-character ones next to it. */
	decodeToGlyphs(encoded: string): string[] {
		return [...encoded].map((code) => this.glyphByCode.get(code) ?? code);
	}

	/** Every tile's encoded code point, in collation order. */
	codes(): string[] {
		return this.tiles.map((t) => this.codeByGlyph.get(t.glyph)!);
	}
}
