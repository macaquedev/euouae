// Canonical parsing of user text into words or letters. Every feature that reads
// typed input — Judge, Word Info, Quiz, Lists — goes through here, so the rules
// (and their edge cases) are defined exactly once.

/** Whitespace-separated tokens, uppercased with non-letters stripped from each.
 *  Splits on whitespace only — never on a mark inside a token — so a word keeps
 *  its identity even with internal punctuation (and stays correct once non-English
 *  lexicons arrive). "qi za!" -> [QI, ZA]. */
export function words(text: string): string[] {
	return text
		.toUpperCase()
		.split(/\s+/)
		.map((token) => token.replace(/[^A-Z]/g, ''))
		.filter(Boolean);
}

/** Every A–Z letter in `text`, uppercased and concatenated into one token. */
export function letters(text: string): string {
	return text.toUpperCase().replace(/[^A-Z]/g, '');
}

/** A localized count with its noun pluralized, e.g. `plural(2)` -> "2 words". */
export function plural(n: number, noun = 'word'): string {
	return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}

/** Join hook tile glyphs for display. Tight ("bcfm") for a single-character
 *  alphabet — unambiguous and matches today's look. Space-separated ("CH LL")
 *  when the alphabet has multi-character tiles, so e.g. Spanish "CH" next to
 *  "LL" can never read as "C","H","L","L" or any other split. Pass the active
 *  lexicon's `alphabet.hasMultiCharTiles`. */
export function joinHooks(hooks: readonly string[], multiChar: boolean): string {
	return hooks.join(multiChar ? ' ' : '');
}
