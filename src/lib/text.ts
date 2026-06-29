// Canonical parsing of user text into words or letters. Every feature that reads
// typed input — Judge, Word Info, Quiz, Lists — goes through here, so the rules
// (and their edge cases) are defined exactly once.

/** Uppercase A–Z runs in `text`, in order, repeats kept. "qi za!" -> [QI, ZA]. */
export function words(text: string): string[] {
	return text.toUpperCase().match(/[A-Z]+/g) ?? [];
}

/** Every A–Z letter in `text`, uppercased and concatenated into one token. */
export function letters(text: string): string {
	return text.toUpperCase().replace(/[^A-Z]/g, '');
}
