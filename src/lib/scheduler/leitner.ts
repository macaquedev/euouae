// Leitner cardbox scheduler — a faithful port of Zyzzyva's QuizDatabase
// scheduling. Correct answers promote a card one box; a miss drops it to box 0.
// Each box has a base interval (days) and a window (± days) the due date fans out
// within. The due date is computed on demand from the box and the last review —
// nothing is stored — so it can never collide with FSRS's schedule.

import { epochSeconds } from '../time';
import type { CardState, Grade, Scheduler } from './types';

/** Days until review for a card in box i (last value used beyond the end). */
export const CARDBOX_SCHEDULE: readonly number[] = [1, 4, 7, 12, 20, 30, 60, 90, 150, 270, 480];
/** ± days of spread applied at box i, so future reviews fan out. */
export const CARDBOX_WINDOW: readonly number[] = [0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50];

const DAY = 86_400;

const at = (table: readonly number[], i: number): number => table[Math.min(i, table.length - 1)];

/**
 * A stable per-question jitter in [-window, +window] days. Derived from the
 * question (FNV-1a hash), not an RNG, so a card's due date is deterministic —
 * the same every time we read it — yet a box's reviews still spread across days.
 */
function jitterDays(question: string, window: number): number {
	if (window <= 0) return 0;
	let h = 2166136261;
	for (let i = 0; i < question.length; i++) {
		h ^= question.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return ((h >>> 0) % (2 * window + 1)) - window;
}

/** The state of a question that has never been studied — treated as due now. */
export function newCardState(question: string): CardState {
	return {
		question,
		correct: 0,
		incorrect: 0,
		streak: 0,
		lastCorrect: null,
		cardbox: null,
		cardboxReviewed: null,
		stability: null,
		difficulty: null,
		lastReview: null
	};
}

export class LeitnerScheduler implements Scheduler {
	readonly id = 'leitner';

	constructor(
		private readonly schedule: readonly number[] = CARDBOX_SCHEDULE,
		private readonly window: readonly number[] = CARDBOX_WINDOW
	) {}

	review(state: CardState, grade: Grade, now: Date): CardState {
		const correct = grade !== 'again';
		const nowSec = epochSeconds(now);
		const inSystem = state.cardbox !== null;

		// Promote on success (a never-seen card jumps straight to box 1, as in
		// Zyzzyva); reset to box 0 on a miss.
		const cardbox = correct ? (inSystem ? state.cardbox! + 1 : 1) : 0;
		const streak = correct
			? state.streak < 0
				? 1
				: state.streak + 1
			: state.streak > 0
				? -1
				: state.streak - 1;

		return {
			question: state.question,
			correct: state.correct + (correct ? 1 : 0),
			incorrect: state.incorrect + (correct ? 0 : 1),
			streak,
			lastCorrect: correct ? nowSec : state.lastCorrect,
			cardbox,
			cardboxReviewed: nowSec,
			// FSRS fields are not Leitner's concern — carry them through untouched.
			stability: state.stability,
			difficulty: state.difficulty,
			lastReview: state.lastReview
		};
	}

	dueAt(state: CardState): number {
		// Never studied under Leitner → due now so it gets introduced.
		if (state.cardbox === null || state.cardboxReviewed === null) return -Infinity;
		const days = at(this.schedule, state.cardbox) + jitterDays(state.question, at(this.window, state.cardbox));
		return state.cardboxReviewed + days * DAY;
	}

	isDue(state: CardState, now: Date): boolean {
		return this.dueAt(state) <= epochSeconds(now);
	}
}
