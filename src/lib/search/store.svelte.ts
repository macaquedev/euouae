// The Search page's inputs and last result, kept in a module store so they
// outlive the page component. The layout re-keys (destroys) each page on
// navigation, so page-local state would be lost; holding it here means leaving
// to Marinate and coming Back returns to the search with its results still open.

import type { SearchCondition, SearchResult, SearchSort } from '$lib/lexicon';
import { defaultCondition, metaFor } from './conditions';

const freshConditions = (): SearchCondition[] => [defaultCondition(metaFor('pattern'))];
const freshSort = (): SearchSort => ({ column: 'probability', direction: 'asc' });

class SearchState {
	conditions = $state<SearchCondition[]>(freshConditions());
	sort = $state<SearchSort>(freshSort());
	result = $state<SearchResult | null>(null);
	searched = $state(false);
	/** The lexicon the current result was produced under; null when no result. */
	lexicon = $state<string | null>(null);

	/** A result is only valid for the lexicon it came from. If the active lexicon
	 *  has changed underneath us, drop it so we never show stale rows from the
	 *  wrong word list. */
	forLexicon(name: string): void {
		if (this.result && this.lexicon !== name) {
			this.result = null;
			this.searched = false;
			this.lexicon = null;
		}
	}
}

export const searchState = new SearchState();
