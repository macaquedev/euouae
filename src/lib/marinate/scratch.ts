// An ad-hoc Marinate source: words handed straight from a search, never written
// to a saved list. Held in memory only, so it survives client-side navigation
// (Back from Marinate to Search) but not a full page reload — which is fine, as
// the search itself is restored from its own store on return.

export interface MarinateScratch {
	readonly name: string;
	readonly words: readonly string[];
}

let current: MarinateScratch | null = null;

export function setScratch(scratch: MarinateScratch): void {
	current = scratch;
}

export function getScratch(): MarinateScratch | null {
	return current;
}
