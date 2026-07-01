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
 * Per-card study state. The counts, `streak`, and `lastReview` are shared: both
 * schedulers advance them on every graded review, so progress under one improves
 * the other. Leitner derives its box in place from `streak` (see
 * LeitnerScheduler.dueAt) rather than storing one — quizzing in FSRS mode moves
 * the Leitner schedule for free, and vice-versa. Only the FSRS memory model
 * (`stability`, `difficulty`) is algorithm-specific.
 */
export interface CardState {
	/** The prompt: an alphagram for anagram decks, or the word itself. */
	readonly question: string;
	readonly correct: number;
	readonly incorrect: number;
	/**
	 * Consecutive correct (positive) or incorrect (negative) streak. Doubles as
	 * the Leitner box: box = max(0, streak), so a hit promotes and a miss drops
	 * the card to box 0 — the same mechanic as Zyzzyva's cardbox.
	 */
	readonly streak: number;
	/** Unix seconds of the last correct response, or null if never. */
	readonly lastCorrect: number | null;

	/** FSRS memory stability (days until R falls to the request retention). */
	readonly stability: number | null;
	/** FSRS difficulty, 1 (easy) – 10 (hard). */
	readonly difficulty: number | null;
	/** Unix seconds of the last graded review (either scheduler); null if never. */
	readonly lastReview: number | null;
}

export interface Scheduler {
	readonly id: 'leitner' | 'fsrs';

	/** Apply a graded response, returning the card's new state. Pure. */
	review(state: CardState, grade: Grade, now: Date): CardState;

	/**
	 * Unix seconds when the card is next due, computed on demand from the card's
	 * state. `-Infinity` for a never-seen card (due now).
	 */
	dueAt(state: CardState): number;

	/** Whether the card is due for review at `now`. */
	isDue(state: CardState, now: Date): boolean;
}
