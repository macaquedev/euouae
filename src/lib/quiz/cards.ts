// Persistence for per-question study state. Wraps the writable user DB and maps
// its rows to and from the scheduler's CardState, scoped to one (lexicon, deck).
// Every graded answer upserts the card and appends to the immutable review_log,
// so either scheduler (Leitner now, FSRS later) can be rebuilt from history.

import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { num, numOrNull, str } from '$lib/sqlite/values';
import { epochSeconds } from '$lib/time';
import { persistUserData, userDb } from '$lib/userdata/db.svelte';
import type { CardState, Grade } from '$lib/scheduler';

type Row = Record<string, SqlValue>;

function rowToCard(r: Row): CardState {
	return {
		question: str(r.question),
		correct: num(r.correct),
		incorrect: num(r.incorrect),
		streak: num(r.streak),
		lastCorrect: numOrNull(r.last_correct),
		cardbox: numOrNull(r.cardbox),
		cardboxReviewed: numOrNull(r.cardbox_reviewed),
		stability: numOrNull(r.stability),
		difficulty: numOrNull(r.difficulty),
		lastReview: numOrNull(r.last_review)
	};
}

export class CardStore {
	private constructor(
		private readonly db: Database,
		readonly lexicon: string,
		readonly deck: string
	) {}

	static async open(lexicon: string, deck: string): Promise<CardStore> {
		return new CardStore(await userDb(), lexicon, deck);
	}

	/** Saved state for every studied question in this deck, keyed by question. */
	loadAll(): Map<string, CardState> {
		const rows = this.db.selectObjects(
			'SELECT question, correct, incorrect, streak, last_correct, cardbox, cardbox_reviewed,' +
				' stability, difficulty, last_review FROM cards WHERE lexicon = ? AND deck = ?',
			[this.lexicon, this.deck]
		);
		return new Map(rows.map((r) => [r.question as string, rowToCard(r)]));
	}

	/**
	 * The FSRS latency baseline (an EMA of first-answer times, in ms) for this
	 * lexicon, or null if none recorded yet. Scoped per lexicon so a faster or
	 * slower word set keeps its own pace.
	 */
	loadBaseline(): number | null {
		const row = this.db.selectObject('SELECT value FROM app_state WHERE key = ?', [
			this.baselineKey()
		]);
		const v = row ? Number(row.value) : NaN;
		return Number.isFinite(v) ? v : null;
	}

	saveBaseline(ms: number): void {
		this.db.exec({
			sql: 'INSERT INTO app_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
			bind: [this.baselineKey(), String(ms)]
		});
		void persistUserData();
	}

	private baselineKey(): string {
		return `fsrs_baseline:${this.lexicon}`;
	}

	/** Persist a graded review: upsert the card and append to the review log. */
	record(card: CardState, grade: Grade, reviewedAt: Date): void {
		const at = epochSeconds(reviewedAt);
		this.db.exec({
			sql:
				'INSERT INTO cards (lexicon, deck, question, correct, incorrect, streak,' +
				' last_correct, cardbox, cardbox_reviewed, stability, difficulty, last_review)' +
				' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)' +
				' ON CONFLICT(lexicon, deck, question) DO UPDATE SET' +
				' correct=excluded.correct, incorrect=excluded.incorrect, streak=excluded.streak,' +
				' last_correct=excluded.last_correct, cardbox=excluded.cardbox,' +
				' cardbox_reviewed=excluded.cardbox_reviewed, stability=excluded.stability,' +
				' difficulty=excluded.difficulty, last_review=excluded.last_review',
			bind: [
				this.lexicon,
				this.deck,
				card.question,
				card.correct,
				card.incorrect,
				card.streak,
				card.lastCorrect,
				card.cardbox,
				card.cardboxReviewed,
				card.stability,
				card.difficulty,
				card.lastReview
			]
		});
		this.db.exec({
			sql: 'INSERT INTO review_log (lexicon, deck, question, reviewed_at, grade) VALUES (?,?,?,?,?)',
			bind: [this.lexicon, this.deck, card.question, at, grade]
		});
		void persistUserData();
	}
}
