// Canonical letter math for Collins/English Scrabble. These pure functions are
// the single definition of each derived quantity, used by both the build pipeline
// (to populate the lexicon) and the app at runtime, so the two can never drift.

/** Standard English/Collins tile values; blank is 0 and not listed. */
export const TILE_VALUES: Readonly<Record<string, number>> = {
	A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
	D: 2, G: 2,
	B: 3, C: 3, M: 3, P: 3,
	F: 4, H: 4, V: 4, W: 4, Y: 4,
	K: 5,
	J: 8, X: 8,
	Q: 10, Z: 10
};

/** Vowels for `num_vowels`: A E I O U only (Y is not counted). */
export const VOWELS: ReadonlySet<string> = new Set(['A', 'E', 'I', 'O', 'U']);

/** Letters sorted ascending — the key that groups a word with its anagrams. */
export function alphagram(word: string): string {
	return [...word].sort().join('');
}

/** Sum of tile values for the word. */
export function pointValue(word: string): number {
	let total = 0;
	for (const letter of word) total += TILE_VALUES[letter] ?? 0;
	return total;
}

/** Count of A/E/I/O/U occurrences. */
export function vowelCount(word: string): number {
	let count = 0;
	for (const letter of word) if (VOWELS.has(letter)) count++;
	return count;
}

/** Number of distinct letters in the word. */
export function uniqueLetterCount(word: string): number {
	return new Set(word).size;
}

/** Uppercase A–Z, in alphabet order; used when probing hooks. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Letters that form a valid word when prepended to `word`, given a membership
 * test. Returned in alphabet order, e.g. "bcfm" -> "BCFM".
 */
export function frontHooks(word: string, isWord: (w: string) => boolean): string {
	let hooks = '';
	for (const letter of ALPHABET) if (isWord(letter + word)) hooks += letter;
	return hooks;
}

/** Letters that form a valid word when appended to `word`. */
export function backHooks(word: string, isWord: (w: string) => boolean): string {
	let hooks = '';
	for (const letter of ALPHABET) if (isWord(word + letter)) hooks += letter;
	return hooks;
}
