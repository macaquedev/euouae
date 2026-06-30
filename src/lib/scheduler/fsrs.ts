// FSRS scheduler — the Free Spaced Repetition Scheduler (the algorithm modern
// Anki ships), a faithful port of FSRS-5. Each card carries a memory model —
// difficulty (1–10) and stability (days until recall probability falls to the
// request retention) — fitted from its review history, so reviews land right as
// recall would otherwise lapse. Unlike Leitner's fixed boxes, intervals adapt
// per card. The four-level grade is produced automatically by the quiz (from
// answer latency), so the user never rates a card.

import { epochSeconds, startOfDayAfter } from '../time';
import type { CardState, Grade, Scheduler } from './types';

const DAY = 86_400;

// FSRS-5 default parameters (19 weights), as shipped by the FSRS project.
const W = [
	0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
	1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621
] as const;

const DECAY = -0.5;
// Chosen so retrievability hits exactly the request retention at t = stability.
const FACTOR = 19 / 81;
const REQUEST_RETENTION = 0.9;
const MIN_STABILITY = 0.01;
const MAX_STABILITY = 36_500; // ~100 years, in days

const ratingValue = (g: Grade): number =>
	g === 'again' ? 1 : g === 'hard' ? 2 : g === 'good' ? 3 : 4;

const clampDifficulty = (d: number): number => Math.min(Math.max(d, 1), 10);
const clampStability = (s: number): number => Math.min(Math.max(s, MIN_STABILITY), MAX_STABILITY);

/** Difficulty a fresh card lands on when first rated `g`. */
function initDifficulty(g: number): number {
	return clampDifficulty(W[4] - Math.exp(W[5] * (g - 1)) + 1);
}

/** Probability of recall after `elapsedDays` for a card of the given stability. */
function retrievability(elapsedDays: number, stability: number): number {
	return Math.pow(1 + FACTOR * (elapsedDays / stability), DECAY);
}

/** Days until the card next falls to the request retention. */
function nextInterval(stability: number): number {
	const days = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
	return Math.max(1, Math.round(days));
}

function nextDifficulty(d: number, g: number): number {
	const deltaD = -W[6] * (g - 3);
	const damped = d + (deltaD * (10 - d)) / 9; // linear damping toward the bounds
	// Mean-revert toward the difficulty an "easy" first rating would have set.
	return clampDifficulty(W[7] * initDifficulty(4) + (1 - W[7]) * damped);
}

function nextStabilityRecall(d: number, s: number, r: number, g: number): number {
	const hardPenalty = g === 2 ? W[15] : 1;
	const easyBonus = g === 4 ? W[16] : 1;
	return clampStability(
		s *
			(1 +
				Math.exp(W[8]) *
					(11 - d) *
					Math.pow(s, -W[9]) *
					(Math.exp(W[10] * (1 - r)) - 1) *
					hardPenalty *
					easyBonus)
	);
}

function nextStabilityForget(d: number, s: number, r: number): number {
	const forgotten =
		W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
	// Post-lapse stability never exceeds the pre-lapse value.
	return clampStability(Math.min(forgotten, s));
}

export class FsrsScheduler implements Scheduler {
	readonly id = 'fsrs';

	review(state: CardState, grade: Grade, now: Date): CardState {
		const g = ratingValue(grade);
		const correct = grade !== 'again';
		const nowSec = epochSeconds(now);
		const inSystem = state.stability !== null && state.difficulty !== null;

		let stability: number;
		let difficulty: number;

		if (!inSystem) {
			// First-ever review: seed memory straight from the rating.
			stability = clampStability(W[g - 1]);
			difficulty = initDifficulty(g);
		} else {
			const elapsedDays = Math.max(0, (nowSec - (state.lastReview ?? nowSec)) / DAY);
			const r = retrievability(elapsedDays, state.stability!);
			difficulty = nextDifficulty(state.difficulty!, g);
			stability = correct
				? nextStabilityRecall(state.difficulty!, state.stability!, r, g)
				: nextStabilityForget(state.difficulty!, state.stability!, r);
		}

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
			// Leitner fields are not FSRS's concern — carry them through untouched.
			cardbox: state.cardbox,
			cardboxReviewed: state.cardboxReviewed,
			stability,
			difficulty,
			lastReview: nowSec
		};
	}

	dueAt(state: CardState): number {
		// Never studied under FSRS → due now. Otherwise due once retrievability
		// would fall to the request retention: the stability interval out from the
		// last review, snapped to the start of that day so it surfaces at 00:00.
		if (state.stability === null || state.lastReview === null) return -Infinity;
		return startOfDayAfter(state.lastReview, nextInterval(state.stability));
	}

	isDue(state: CardState, now: Date): boolean {
		return this.dueAt(state) <= epochSeconds(now);
	}
}
