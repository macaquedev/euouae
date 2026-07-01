// Zyzzyva's predefined word-study sets (Search > Belongs to Group), ported from
// its WordEngine::isSetMember (GPL-licensed source: the algorithm is free to
// port; the underlying stem lists and playability corpus are Collins' own
// licensed data and are supplied by the caller, never bundled here). All of
// these are English-specific heuristics baked into Zyzzyva itself — for a
// non-English alphabet the reference words below simply won't tokenize, so
// the corresponding set is computed as empty rather than guessed at.

import type { Alphabet, Tile } from './alphabet';
import { combinationsFor } from './probability';

/** Is `smaller` a sub-multiset of `larger`? Both must already be alphagrams
 *  (sorted, one character per tile) of the *same* alphabet's encoding. */
function isSubMultiset(smaller: string, larger: string): boolean {
	let i = 0;
	for (let j = 0; i < smaller.length && j < larger.length; j++) {
		if (smaller[i] === larger[j]) i++;
	}
	return i === smaller.length;
}

/** True if some stem alphagram is a sub-multiset of `alphagram` — Zyzzyva's
 *  Type I Sevens/Eights and Eights-from-Seven-Letter-Stems all reduce to this
 *  same check, just against a different stem set and word length. */
export function matchesAnyStem(alphagram: string, stems: ReadonlySet<string> | undefined): boolean {
	if (!stems) return false;
	for (const stem of stems) {
		if (stem.length < alphagram.length && isSubMultiset(stem, alphagram)) return true;
	}
	return false;
}

// The exact 24-letter pool Zyzzyva hardcodes for Type II Sevens/Eights: a
// word qualifies if its whole alphagram fits within this multiset.
const TYPE_TWO_POOL = 'AAADEEEEGIIILNNOORRSSTTU';

function poolCaps(alphabet: Alphabet): Map<string, number> | null {
	const tiles = alphabet.tokenizeStrict(TYPE_TWO_POOL);
	if (!tiles) return null; // non-English alphabet: this pool is meaningless
	const caps = new Map<string, number>();
	for (const t of tiles) caps.set(t.glyph, (caps.get(t.glyph) ?? 0) + 1);
	return caps;
}

/** Whether every tile of `tiles` fits within the Type II reference pool,
 *  respecting its per-letter caps (e.g. at most 4 E's). */
export function matchesTypeTwoPool(alphabet: Alphabet, tiles: readonly Tile[]): boolean {
	const caps = poolCaps(alphabet);
	if (!caps) return false;
	const seen = new Map<string, number>();
	for (const t of tiles) {
		const n = (seen.get(t.glyph) ?? 0) + 1;
		if (n > (caps.get(t.glyph) ?? 0)) return false;
		seen.set(t.glyph, n);
	}
	return true;
}

/** Draw-combinations (2 blanks) of a reference word, for the Type III
 *  Sevens/Eights threshold — null if the word doesn't tokenize under this
 *  alphabet (non-English lexicons have no faithful equivalent). */
export function referenceCombinations(alphabet: Alphabet, referenceWord: string): number | null {
	if (!alphabet.tokenizeStrict(referenceWord)) return null;
	return combinationsFor(alphabet)(referenceWord)[2];
}

/**
 * High Fives: a 5-letter word where every tile is worth 5 points or less, and
 * at least one of the first/last tiles is worth 4 or 5 — Zyzzyva's exact
 * SetHighFives rule (a pure function of tile point values, so it needs no
 * external data at all).
 */
export function isHighFive(tiles: readonly Tile[]): boolean {
	if (tiles.length !== 5) return false;
	if (!tiles.every((t) => t.value <= 5)) return false;
	const edgeValue = (i: number) => tiles[i].value === 4 || tiles[i].value === 5;
	return edgeValue(0) || edgeValue(tiles.length - 1);
}
