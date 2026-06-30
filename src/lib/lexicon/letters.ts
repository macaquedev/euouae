// Canonical letter math for English/Collins Scrabble, now thin wrappers over the
// English Alphabet (see alphabet.ts / alphabets.ts) so the tile data lives in one
// place. The build pipeline and the app both go through these, so the two can
// never drift. A per-lexicon caller can use the Alphabet methods directly.

import { ENGLISH } from './alphabets';

/** Standard English/Collins tile values; blank is 0 and not listed. */
export const TILE_VALUES: Readonly<Record<string, number>> = Object.fromEntries(
	ENGLISH.tiles.map((t) => [t.glyph, t.value])
);

/** Vowels for `num_vowels`: A E I O U only (Y is not counted). */
export const VOWELS: ReadonlySet<string> = new Set(
	ENGLISH.tiles.filter((t) => t.vowel).map((t) => t.glyph)
);

/** Uppercase A–Z, in alphabet order; used when probing hooks. */
export const ALPHABET = ENGLISH.tiles.map((t) => t.glyph).join('');

/** Letters sorted ascending — the key that groups a word with its anagrams. */
export const alphagram = (word: string): string => ENGLISH.alphagram(word);

/** Sum of tile values for the word. */
export const pointValue = (word: string): number => ENGLISH.pointValue(word);

/** Count of A/E/I/O/U occurrences. */
export const vowelCount = (word: string): number => ENGLISH.vowelCount(word);

/** Number of distinct letters in the word. */
export const uniqueLetterCount = (word: string): number => ENGLISH.uniqueTileCount(word);

/**
 * Letters that form a valid word when prepended to `word`, given a membership
 * test. Returned in alphabet order, e.g. "bcfm" -> "BCFM". English tiles are
 * always one character, so joining them is never ambiguous (unlike a general
 * alphabet's `frontHooks`/`backHooks`, which return separate glyphs).
 */
export const frontHooks = (word: string, isWord: (w: string) => boolean): string =>
	ENGLISH.frontHooks(word, isWord).join('');

/** Letters that form a valid word when appended to `word`. */
export const backHooks = (word: string, isWord: (w: string) => boolean): string =>
	ENGLISH.backHooks(word, isWord).join('');
