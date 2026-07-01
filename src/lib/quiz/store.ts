// The in-progress quiz session, held outside any component so it survives route
// navigation within the app: leaving the quiz page and returning resumes the
// same session — same remaining questions, same running tally — instead of
// silently starting a fresh (and, in spaced modes, due-filtered) one. Keyed by
// lexicon + deck so an explicit request for a different deck still starts anew.

import type { QuizSession } from './session.svelte';

interface Active {
	readonly lexicon: string;
	readonly deckId: string;
	readonly session: QuizSession;
}

class QuizStore {
	private current: Active | null = null;

	/** The still-running (not finished) session for this lexicon, if any. */
	live(lexicon: string): { deckId: string; session: QuizSession } | null {
		const c = this.current;
		if (c && c.lexicon === lexicon && !c.session.done)
			return { deckId: c.deckId, session: c.session };
		return null;
	}

	/** The live session for exactly this lexicon+deck, ready to resume. */
	resume(lexicon: string, deckId: string): QuizSession | null {
		const l = this.live(lexicon);
		return l && l.deckId === deckId ? l.session : null;
	}

	/** Adopt a freshly built session as the active one, committing any pending
	 *  grade on a different session it replaces. */
	begin(lexicon: string, deckId: string, session: QuizSession): void {
		if (this.current && this.current.session !== session) this.current.session.commitPending();
		this.current = { lexicon, deckId, session };
	}

	/** End the active session (Quit / New quiz / lexicon switch), flushing its
	 *  pending grade so a revealed-but-unadvanced answer isn't dropped. */
	end(): void {
		this.current?.session.commitPending();
		this.current = null;
	}
}

export const quiz = new QuizStore();
