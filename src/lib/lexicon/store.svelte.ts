// One shared, reactive handle on the active lexicon engine. The layout kicks off
// loading once; every page reads `lexicon.engine` instead of repeating its own
// onMount load + try/catch. `loadLexicon` already de-dupes the heavy work, so
// switching back to a lexicon is instant.

import { loadLexicon, DEFAULT_LEXICON, type LexiconEngine } from './index';

class LexiconStore {
	name = $state(DEFAULT_LEXICON);
	engine = $state<LexiconEngine | null>(null);
	error = $state<string | null>(null);

	/** Begin (or switch to) a lexicon; idempotent for an already-active name. */
	load(name: string = this.name): void {
		if (name === this.name && (this.engine || this.error)) return;
		this.name = name;
		this.engine = null;
		this.error = null;
		loadLexicon(name)
			.then((engine) => {
				if (this.name === name) this.engine = engine;
			})
			.catch((err) => {
				if (this.name === name) this.error = err instanceof Error ? err.message : String(err);
			});
	}
}

export const lexicon = new LexiconStore();
