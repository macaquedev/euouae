// The Search page's inputs and last result, kept in a module store so they
// outlive the page component. The layout re-keys (destroys) each page on
// navigation, so page-local state would be lost; holding it here means leaving
// to Marinate and coming Back returns to the search with its results still open.

import type { LexiconEngine, SearchCondition, SearchResult, SearchSort } from '$lib/lexicon';
import { defaultCondition, metaFor } from './conditions';

const freshConditions = (): SearchCondition[] => [defaultCondition(metaFor('pattern'))];
const freshSort = (): SearchSort => ({ column: 'probability', direction: 'asc' });

// Conditions whose value is literal tile glyphs from one lexicon's alphabet
// (a pattern, rack, or letter set) — meaningless, or outright wrong, once the
// alphabet underneath them changes (e.g. switching to a lexicon with digraph
// tiles). Numeric ranges, free-text conditions (definition, part of speech),
// the fixed-choice group condition, and word-set conditions (already resolved
// to plain word strings, independent of any alphabet) aren't alphabet-shaped,
// so they carry over untouched.
const ALPHABET_DEPENDENT_TYPES = new Set([
	'pattern',
	'anagram',
	'subanagram',
	'includeLetters',
	'prefix',
	'suffix',
	'consistOf'
]);

/** A signature that's equal iff two alphabets have the same tiles in the same
 *  order — cheap enough to recompute on every lexicon switch. */
function alphabetKeyOf(engine: LexiconEngine): string {
	return engine.alphabet.tiles.map((t) => t.glyph).join('\0');
}

class SearchState {
	conditions = $state<SearchCondition[]>(freshConditions());
	sort = $state<SearchSort>(freshSort());
	/** Cap on rows returned (Zyzzyva's "+limit" on rank-ordered searches); null
	 *  for no cap. */
	limit = $state<number | null>(null);
	result = $state<SearchResult | null>(null);
	searched = $state(false);
	/** The lexicon the current result was produced under; null when no result. */
	lexicon = $state<string | null>(null);
	/** The alphabet the current `conditions` were authored against; null until
	 *  the first lexicon has loaded. */
	private alphabetKey: string | null = null;

	/** A result is only valid for the lexicon it came from — drop it on any
	 *  lexicon switch so we never show stale rows from the wrong word list.
	 *  Conditions are stickier: they only reset when the new lexicon's alphabet
	 *  actually differs from the one they were built against, so switching
	 *  between same-alphabet dictionaries (e.g. NWL23 <-> CSW24) keeps your
	 *  filters intact instead of silently reusing them against the wrong tile
	 *  set. */
	forLexicon(engine: LexiconEngine | null): void {
		if (!engine) return; // still loading — nothing to compare yet

		if (this.result && this.lexicon !== engine.name) {
			this.result = null;
			this.searched = false;
			this.lexicon = null;
		}

		const key = alphabetKeyOf(engine);
		if (this.alphabetKey !== null && this.alphabetKey !== key) {
			this.conditions = this.conditions.map((c) =>
				c.kind === 'string' && ALPHABET_DEPENDENT_TYPES.has(c.type) ? defaultCondition(metaFor(c.type)) : c
			);
		}
		this.alphabetKey = key;
	}
}

export const searchState = new SearchState();
