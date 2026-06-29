// The Scrabble adjudication rule, in one place: a play is acceptable iff every
// word it forms is valid. The verdict covers the whole play only — no per-word
// detail and no definitions, so nothing leaks about which word failed.

import type { LexiconEngine } from '$lib/lexicon';
import { words } from '$lib/text';

export interface Verdict {
	acceptable: boolean;
	words: string[];
}

/** Adjudicate typed input, or null if it contains no words. */
export function judgePlay(engine: LexiconEngine, input: string): Verdict | null {
	const play = words(input);
	if (play.length === 0) return null;
	return { acceptable: play.every((word) => engine.isValid(word)), words: play };
}
