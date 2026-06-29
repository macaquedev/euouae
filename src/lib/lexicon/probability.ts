// Draw-probability combinatorics, ported from Zyzzyva's LetterBag. The number
// of ways to draw a word's tiles from a full bag is pure combinatorics — no
// external data — so we compute it ourselves rather than import it.
//
// combinations[b] is CUMULATIVE: ways to draw the rack allowing up to b blanks
// to substitute for tiles, so combinations[0] <= [1] <= [2]. Ranking words
// within a length by combinations[b] descending gives the probability order.

import type { BlankCount, ByBlanks } from './types';

/** English/Collins tile counts in a full bag; blanks handled separately. */
export const TILE_FREQUENCIES: Readonly<Record<string, number>> = {
	A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
	N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1
};

/** Number of blank tiles in a full bag. */
export const BLANK_COUNT = 2;

const MAX_FREQ = Math.max(...Object.values(TILE_FREQUENCIES));

/** choose[n][k] = C(n, k), precomputed up to the largest tile frequency. */
const choose: number[][] = (() => {
	const table: number[][] = [];
	for (let n = 0; n <= MAX_FREQ; n++) {
		table[n] = [1];
		for (let k = 1; k <= n; k++) {
			table[n][k] = (table[n][k - 1] * (n - k + 1)) / k;
		}
	}
	return table;
})();

/** C(freq, k), or 0 when k exceeds the available tiles. */
function chooseTiles(freq: number, k: number): number {
	return k <= freq ? choose[freq][k] : 0;
}

interface LetterCount {
	readonly freq: number;
	count: number;
}

/** Distinct letters of `word` with their bag frequency and required count. */
function letterCounts(word: string): LetterCount[] {
	const byLetter = new Map<string, LetterCount>();
	for (const letter of word) {
		const existing = byLetter.get(letter);
		if (existing) existing.count++;
		else byLetter.set(letter, { freq: TILE_FREQUENCIES[letter] ?? 0, count: 1 });
	}
	return [...byLetter.values()];
}

/** Product of C(freq, count) across all letters for the current counts. */
function combosForCounts(letters: LetterCount[]): number {
	let product = 1;
	for (const l of letters) product *= chooseTiles(l.freq, l.count);
	return product;
}

/**
 * Cumulative draw combinations for the word, indexed by blanks allowed (0/1/2).
 * Faithful port of LetterBag::getNumCombinations.
 */
export function combinations(word: string): ByBlanks {
	const letters = letterCounts(word);

	const noBlanks = combosForCounts(letters);

	let oneBlank = 0;
	for (const l of letters) {
		l.count--;
		oneBlank += chooseTiles(BLANK_COUNT, 1) * combosForCounts(letters);
		l.count++;
	}

	let twoBlanks = 0;
	for (let i = 0; i < letters.length; i++) {
		letters[i].count--;
		for (let j = i; j < letters.length; j++) {
			if (letters[j].count === 0) continue;
			letters[j].count--;
			twoBlanks += chooseTiles(BLANK_COUNT, 2) * combosForCounts(letters);
			letters[j].count++;
		}
		letters[i].count++;
	}

	return { 0: noBlanks, 1: noBlanks + oneBlank, 2: noBlanks + oneBlank + twoBlanks };
}

interface RankableWord {
	readonly word: string;
	readonly length: number;
	readonly alphagram: string;
	readonly combinations: ByBlanks;
}

/**
 * Assign each word its 1-based probability rank within its own length, for each
 * blank count. Draw probability is a property of the tiles — the alphagram — so
 * all anagrams of an alphagram share one rank (competition ranking): a rank is
 * the group's starting slot, and the next alphagram skips ahead by the group's
 * size, e.g. 1, 1, 3. This deliberately diverges from Zyzzyva, which breaks the
 * tie by spelling to hand equal-probability anagrams distinct ranks. A bonus:
 * because anagrams share a rank, a probability range can never split a group.
 */
export function probabilityOrders(entries: ReadonlyArray<RankableWord>): Map<string, ByBlanks> {
	const byLength = new Map<number, RankableWord[]>();
	for (const e of entries) {
		const bucket = byLength.get(e.length);
		if (bucket) bucket.push(e);
		else byLength.set(e.length, [e]);
	}

	const result = new Map<string, Record<BlankCount, number>>();
	for (const bucket of byLength.values()) {
		for (const e of bucket) result.set(e.word, { 0: 0, 1: 0, 2: 0 });
		for (const blanks of [0, 1, 2] as BlankCount[]) {
			const sorted = [...bucket].sort(
				(a, b) =>
					b.combinations[blanks] - a.combinations[blanks] ||
					a.alphagram.localeCompare(b.alphagram) ||
					a.word.localeCompare(b.word)
			);
			let rank = 0;
			let prevAlphagram: string | null = null;
			sorted.forEach((e, i) => {
				if (e.alphagram !== prevAlphagram) {
					rank = i + 1;
					prevAlphagram = e.alphagram;
				}
				result.get(e.word)![blanks] = rank;
			});
		}
	}
	return result;
}
