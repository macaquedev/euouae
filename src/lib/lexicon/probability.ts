// Draw-probability combinatorics, ported from Zyzzyva's LetterBag. The number
// of ways to draw a word's tiles from a full bag is pure combinatorics — no
// external data — so we compute it ourselves rather than import it.
//
// combinations[b] is CUMULATIVE: ways to draw the rack allowing up to b blanks
// to substitute for tiles, so combinations[0] <= [1] <= [2]. Ranking words
// within a length by combinations[b] descending gives the probability order.

import type { BlankCount, ByBlanks } from './types';
import type { Alphabet } from './alphabet';

interface TileCount {
	readonly freq: number;
	count: number;
}

/**
 * A draw-combinations calculator bound to one alphabet's bag. The C(n, k) table
 * is built once for the bag's largest tile frequency, then reused for every word;
 * each word is tokenized into tiles, so multi-character tiles (CH, LL) count as
 * one. Faithful port of LetterBag::getNumCombinations.
 */
export function combinationsFor(alphabet: Alphabet): (word: string) => ByBlanks {
	const blankCount = alphabet.blankCount;
	const maxFreq = Math.max(...alphabet.tiles.map((t) => t.frequency));

	const choose: number[][] = [];
	for (let n = 0; n <= maxFreq; n++) {
		choose[n] = [1];
		for (let k = 1; k <= n; k++) choose[n][k] = (choose[n][k - 1] * (n - k + 1)) / k;
	}
	const chooseTiles = (freq: number, k: number): number => (k <= freq ? choose[freq][k] : 0);

	/** Distinct tiles of `word` with their bag frequency and required count. */
	const tileCounts = (word: string): TileCount[] => {
		const byGlyph = new Map<string, TileCount>();
		for (const tile of alphabet.tokenize(word)) {
			const existing = byGlyph.get(tile.glyph);
			if (existing) existing.count++;
			else byGlyph.set(tile.glyph, { freq: tile.frequency, count: 1 });
		}
		return [...byGlyph.values()];
	};

	const combosForCounts = (tiles: TileCount[]): number => {
		let product = 1;
		for (const t of tiles) product *= chooseTiles(t.freq, t.count);
		return product;
	};

	return (word: string): ByBlanks => {
		const tiles = tileCounts(word);
		const noBlanks = combosForCounts(tiles);

		let oneBlank = 0;
		for (const t of tiles) {
			t.count--;
			oneBlank += chooseTiles(blankCount, 1) * combosForCounts(tiles);
			t.count++;
		}

		let twoBlanks = 0;
		for (let i = 0; i < tiles.length; i++) {
			tiles[i].count--;
			for (let j = i; j < tiles.length; j++) {
				if (tiles[j].count === 0) continue;
				tiles[j].count--;
				twoBlanks += chooseTiles(blankCount, 2) * combosForCounts(tiles);
				tiles[j].count++;
			}
			tiles[i].count++;
		}

		return { 0: noBlanks, 1: noBlanks + oneBlank, 2: noBlanks + oneBlank + twoBlanks };
	};
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
