// A running anagram quiz. Holds the queue of questions, the current answer
// attempt, and the running tally — all reactive so the page is a thin view.
// Grading is automatic: a question is correct only if every anagram is found,
// matching Zyzzyva. The spaced modes (FSRS, Cardbox) reschedule via the
// scheduler — FSRS additionally grades hard/good/easy from first-answer latency
// against a personal baseline; Standard drills without touching any schedule.

import type { LexiconEngine, WordEntry } from '$lib/lexicon';
import { words } from '$lib/text';
import { newCardState, type CardState, type Grade, type Scheduler } from '$lib/scheduler';
import type { CardStore } from './cards';

export type QuizMethod = 'cardbox' | 'fsrs' | 'standard';
export type QuizOrder =
	| 'random'
	| 'alphabetical'
	| 'probability'
	| 'playability'
	| 'schedule'
	| 'schedule-zero-first';

/** Locale-independent string compare, used to break ties stably. */
function byAlpha(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function shuffle<T>(items: T[]): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

/** The binary result the quiz observes directly: were all anagrams found? */
type Outcome = 'correct' | 'incorrect';

// FSRS auto-grading from first-answer latency, relative to a personal baseline.
const BASELINE_ALPHA = 0.2; // EMA weight given to each new sample
const FAST_RATIO = 0.6; // first answer under 60% of baseline → Easy
const SLOW_RATIO = 1.6; // over 160% of baseline → Hard
const MAX_RELIABLE_MS = 60_000; // slower than this, distrust the timing → Good

export class QuizSession {
	queue = $state<string[]>([]);
	index = $state(0);
	guess = $state('');
	revealed = $state(false);
	answers = $state<WordEntry[]>([]);
	foundWords = $state<Set<string>>(new Set());
	/** The current question's outcome once revealed; persisted on advance so it can
	 *  be overridden first (Zyzzyva's Mark as correct/missed). */
	graded = $state<Outcome | null>(null);
	correctCount = $state(0);
	incorrectCount = $state(0);
	/** Questions that were due but excluded because they are not yet (spaced modes). */
	scheduledCount = $state(0);

	private cards: Map<string, CardState>;

	// FSRS first-answer timing for the current question (ms, via Date.now()).
	private baseline: number | null;
	private shownAt = 0;
	private firstAnswerAt: number | null = null;
	private pausedMs = 0;
	private pauseStartedAt: number | null = null;
	private timingReliable = true;

	constructor(
		private readonly engine: LexiconEngine,
		private readonly store: CardStore,
		private readonly scheduler: Scheduler,
		private readonly method: QuizMethod,
		questions: string[],
		order: QuizOrder,
		now: Date = new Date()
	) {
		this.cards = store.loadAll();
		this.baseline = store.loadBaseline();

		const ordered = this.orderQuestions(questions, order);
		// Both spaced modes (cardbox, fsrs) quiz only what is due; standard drills all.
		if (method !== 'standard') {
			this.queue = ordered.filter((q) => this.scheduler.isDue(this.cardFor(q), now));
			this.scheduledCount = questions.length - this.queue.length;
		} else {
			this.queue = ordered;
		}
		if (this.queue.length > 0) this.loadCurrent();
	}

	get question(): string {
		return this.queue[this.index] ?? '';
	}
	get total(): number {
		return this.queue.length;
	}
	get done(): boolean {
		return this.index >= this.queue.length;
	}
	get missed(): WordEntry[] {
		return this.answers.filter((a) => !this.foundWords.has(a.word));
	}

	private cardFor(question: string): CardState {
		return this.cards.get(question) ?? newCardState(question);
	}

	/** Order the questions per the chosen mode, mirroring Zyzzyva's orderings. */
	private orderQuestions(questions: string[], order: QuizOrder): string[] {
		const qs = [...questions];
		switch (order) {
			case 'alphabetical':
				return qs.sort(byAlpha);
			case 'random':
				return shuffle(qs);
			case 'probability':
				// Most probable first, by raw tile combinations (0 blanks).
				return this.sortByDesc(qs, (q) => this.combinations(q));
			case 'playability':
				// Most playable first, by the best anagram's playability.
				return this.sortByDesc(qs, (q) => this.bestPlayability(q));
			case 'schedule':
				return this.sortBySchedule(qs, false);
			case 'schedule-zero-first':
				return this.sortBySchedule(qs, true);
		}
	}

	/** Combinations of the alphagram's tiles; identical across its anagrams. */
	private combinations(alphagram: string): number {
		return this.engine.anagrams(alphagram)[0]?.combinations?.[0] ?? 0;
	}

	/** Highest playability among the alphagram's anagrams (Zyzzyva's choice). */
	private bestPlayability(alphagram: string): number {
		let best = 0;
		for (const a of this.engine.anagrams(alphagram)) {
			if (a.playability != null && a.playability > best) best = a.playability;
		}
		return best;
	}

	private sortByDesc(questions: string[], key: (q: string) => number): string[] {
		return questions
			.map((q) => ({ q, k: key(q) }))
			.sort((a, b) => b.k - a.k || byAlpha(a.q, b.q))
			.map((x) => x.q);
	}

	/** By soonest due date; `zeroFirst` floats box-0 and never-seen cards ahead. */
	private sortBySchedule(questions: string[], zeroFirst: boolean): string[] {
		return questions
			.map((q) => {
				const card = this.cardFor(q);
				return {
					q,
					next: this.scheduler.dueAt(card), // computed per the active scheduler
					zero: card.cardbox === null || card.cardbox === 0
				};
			})
			.sort((a, b) => {
				if (zeroFirst && a.zero !== b.zero) return a.zero ? -1 : 1;
				return a.next - b.next || byAlpha(a.q, b.q);
			})
			.map((x) => x.q);
	}

	private loadCurrent(): void {
		this.answers = this.engine.anagrams(this.question);
		this.guess = '';
		this.revealed = false;
		this.graded = null;
		this.foundWords = new Set();
		this.resetTiming();
	}

	private resetTiming(): void {
		this.shownAt = Date.now();
		this.firstAnswerAt = null;
		this.pausedMs = 0;
		this.pauseStartedAt = null;
		this.timingReliable = true;
	}

	/**
	 * Play the typed guess (on Enter): pull any complete answers it contains into
	 * `foundWords`, then clear the box. A token that is a genuine rearrangement of
	 * the rack but isn't a valid word is a real wrong answer — it fails the whole
	 * question (Zyzzyva), grading it incorrect and revealing it. A token that isn't
	 * even an anagram of the rack is just a typo: it's reported `invalid` so the
	 * caller can flash it, with no penalty. Any correct words in the same guess are
	 * credited first. `duplicate` names a word re-typed after already being found.
	 * Finding every answer auto-grades the question correct and reveals it.
	 */
	submit(now: Date = new Date()): { duplicate: string | null; invalid: boolean } {
		if (this.revealed || this.done) return { duplicate: null, invalid: false };

		const answerWords = new Set(this.answers.map((a) => a.word));
		const rack = [...this.question].sort().join('');
		const found = new Set(this.foundWords);
		let dup: string | null = null;
		let wrong = false;
		let invalid = false;

		for (const token of words(this.guess)) {
			if (answerWords.has(token)) {
				if (found.has(token)) dup = token;
				else found.add(token);
			} else if ([...token].sort().join('') === rack) {
				wrong = true; // a real rearrangement of the rack, just not a word
			} else {
				invalid = true; // junk / typo — not even built from the rack's tiles
			}
		}

		this.foundWords = found;
		this.guess = '';

		// The first correct word is the recognition-latency signal FSRS grades on.
		if (this.firstAnswerAt === null && found.size > 0) this.firstAnswerAt = now.getTime();

		if (wrong) this.setGrade('incorrect');
		else if (this.foundWords.size === this.answers.length) this.setGrade('correct');
		return { duplicate: dup, invalid };
	}

	/** Give up on the rest: absorb any complete answers still in the box, then
	 *  reveal — grading correct only if every answer was found. */
	reveal(): void {
		if (this.revealed || this.done) return;

		const answerWords = new Set(this.answers.map((a) => a.word));
		const found = new Set(this.foundWords);
		for (const token of words(this.guess)) if (answerWords.has(token)) found.add(token);
		this.foundWords = found;
		this.guess = '';

		this.setGrade(found.size === this.answers.length ? 'correct' : 'incorrect');
	}

	/** Override the auto-grade for the revealed question (Mark as correct/missed). */
	mark(): void {
		if (!this.revealed || this.graded === null) return;
		if (this.graded === 'correct') {
			this.graded = 'incorrect';
			this.correctCount--;
			this.incorrectCount++;
		} else {
			this.graded = 'correct';
			this.incorrectCount--;
			this.correctCount++;
		}
	}

	private setGrade(outcome: Outcome): void {
		this.graded = outcome;
		this.revealed = true;
		if (outcome === 'correct') this.correctCount++;
		else this.incorrectCount++;
	}

	/** Pause the latency clock — the tab was hidden or the window lost focus. */
	pauseTimer(at: number = Date.now()): void {
		if (this.pauseStartedAt === null) this.pauseStartedAt = at;
	}

	/** Resume after a pause, banking the hidden/idle span out of the measurement. */
	resumeTimer(at: number = Date.now()): void {
		if (this.pauseStartedAt !== null) {
			this.pausedMs += at - this.pauseStartedAt;
			this.pauseStartedAt = null;
		}
	}

	/** Flag the current question's timing as untrustworthy (a long idle gap). */
	markTimingUnreliable(): void {
		this.timingReliable = false;
	}

	/** First-answer latency with hidden/idle time removed, or Infinity if none. */
	private get effectiveMs(): number {
		if (this.firstAnswerAt === null) return Infinity;
		return Math.max(0, this.firstAnswerAt - this.shownAt - this.pausedMs);
	}

	/** Map the binary outcome to a four-level FSRS grade (auto, never self-rated). */
	private gradeFor(outcome: Outcome): Grade {
		if (outcome === 'incorrect') return 'again';
		if (this.method !== 'fsrs') return 'good'; // Leitner ignores the hard/good/easy split
		const eff = this.effectiveMs;
		if (!this.timingReliable || this.baseline === null || eff > MAX_RELIABLE_MS) return 'good';
		if (eff < this.baseline * FAST_RATIO) return 'easy';
		if (eff > this.baseline * SLOW_RATIO) return 'hard';
		return 'good';
	}

	private updateBaseline(ms: number): void {
		this.baseline =
			this.baseline === null ? ms : this.baseline * (1 - BASELINE_ALPHA) + ms * BASELINE_ALPHA;
		this.store.saveBaseline(this.baseline);
	}

	/** Persist the pending grade if the question was revealed but not advanced
	 *  (e.g. on quit), so a self-assessed answer isn't silently dropped. */
	commitPending(now: Date = new Date()): void {
		if (this.graded === null) return;
		this.persist(this.graded, now);
		this.graded = null;
	}

	/** Persist one review: derive the grade, reschedule, upsert the card, log it. */
	private persist(outcome: Outcome, now: Date): void {
		const before = this.cardFor(this.question);
		const grade = this.gradeFor(outcome);
		const reviewed = this.scheduler.review(before, grade, now);
		// Standard drilling records stats but leaves all scheduling state untouched.
		const next =
			this.method === 'standard'
				? {
						...reviewed,
						cardbox: before.cardbox,
						cardboxReviewed: before.cardboxReviewed,
						stability: before.stability,
						difficulty: before.difficulty,
						lastReview: before.lastReview
					}
				: reviewed;
		this.cards.set(this.question, next);
		this.store.record(next, grade, now);

		// Learn the user's pace from trustworthy correct answers (FSRS only).
		if (this.method === 'fsrs' && outcome === 'correct' && this.timingReliable) {
			const eff = this.effectiveMs;
			if (Number.isFinite(eff) && eff <= MAX_RELIABLE_MS) this.updateBaseline(eff);
		}
	}

	/** Persist the (possibly overridden) grade, then move to the next question. */
	advance(now: Date = new Date()): void {
		if (this.done) return;
		this.commitPending(now);
		this.index++;
		if (!this.done) this.loadCurrent();
	}
}
