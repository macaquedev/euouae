// Spaced-repetition core. One `Scheduler` interface, two implementations
// (Leitner today, FSRS later). Every scheduler consumes the same review event,
// so decks can switch algorithms without losing history.

/**
 * A graded response on the four-level FSRS scale. Leitner only distinguishes
 * `again` (miss) from the rest (hit); FSRS uses all four. The quiz derives the
 * grade automatically — `again` on a miss, otherwise hard/good/easy from how
 * fast the first answer came — so the user never self-assesses.
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

/**
 * Per-card study state. Each scheduler owns its own fields and derives the due
 * date on demand from them — nothing is shared, so studying a card under one
 * algorithm never disturbs when it next surfaces under the other.
 */
export interface CardState {
	/** The prompt: an alphagram for anagram decks, or the word itself. */
	readonly question: string;
	readonly correct: number;
	readonly incorrect: number;
	/** Consecutive correct (positive) or incorrect (negative) streak. */
	readonly streak: number;
	/** Unix seconds of the last correct response, or null if never. */
	readonly lastCorrect: number | null;

	/** Leitner box index; null means the card is not in the cardbox system. */
	readonly cardbox: number | null;
	/** Unix seconds of the last Leitner review (when the box was last set). */
	readonly cardboxReviewed: number | null;

	/** FSRS memory stability (days until R falls to the request retention). */
	readonly stability: number | null;
	/** FSRS difficulty, 1 (easy) – 10 (hard). */
	readonly difficulty: number | null;
	/** Unix seconds of the last FSRS review (its elapsed-time input). */
	readonly lastReview: number | null;
}

export interface Scheduler {
	readonly id: 'leitner' | 'fsrs';

	/** Apply a graded response, returning the card's new state. Pure. */
	review(state: CardState, grade: Grade, now: Date): CardState;

	/**
	 * Unix seconds when the card is next due, derived purely from this
	 * scheduler's own fields. `-Infinity` for a never-seen card (due now).
	 */
	dueAt(state: CardState): number;

	/** Whether the card is due for review at `now`. */
	isDue(state: CardState, now: Date): boolean;
}
