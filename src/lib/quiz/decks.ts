// What to study. A deck names a question set (alphagrams) plus a stable `id`
// used as the persistence key, so progress sticks to the deck across sessions.
// Decks are built from the user's saved lists.

import type { LexiconEngine } from '$lib/lexicon';
import { alphagram } from '$lib/lexicon/letters';

export interface Deck {
	readonly id: string;
	readonly label: string;
	/** How many words feed this deck (before validity/alphagram grouping). */
	readonly size: number;
	/** The questions to study — alphagrams, for anagram decks. */
	resolve(engine: LexiconEngine): string[];
}

/** A deck over a saved list: the distinct alphagrams of its valid words. */
export function listDeck(id: number, name: string, words: readonly string[]): Deck {
	return {
		id: `list-${id}`,
		label: name,
		size: words.length,
		resolve: (engine) => [
			...new Set(words.filter((w) => engine.isValid(w)).map((w) => alphagram(w)))
		].sort()
	};
}
