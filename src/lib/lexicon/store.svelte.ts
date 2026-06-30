// One shared, reactive handle on the active lexicon engine and the catalog of
// lexicons to switch between. The layout kicks off loading once; every page reads
// `lexicon.engine` instead of repeating its own onMount load + try/catch.
// `loadLexicon` already de-dupes the heavy work, so switching back is instant.
// The chosen lexicon is remembered across sessions in the user database.

import { loadLexicon, evictLexicon, DEFAULT_LEXICON, type LexiconEngine } from './index';
import { listLexicons, type LexiconInfo } from './registry';
import { userDb, persistUserData } from '$lib/userdata/db';

const SELECTED_KEY = 'selected_lexicon';

async function readSelected(): Promise<string | null> {
	const row = (await userDb()).selectObject('SELECT value FROM app_state WHERE key = ?', [
		SELECTED_KEY
	]);
	return row ? (row.value as string) : null;
}

async function writeSelected(name: string): Promise<void> {
	(await userDb()).exec({
		sql: 'INSERT INTO app_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
		bind: [SELECTED_KEY, name]
	});
	void persistUserData();
}

class LexiconStore {
	name = $state(DEFAULT_LEXICON);
	engine = $state<LexiconEngine | null>(null);
	error = $state<string | null>(null);
	available = $state<LexiconInfo[]>([]);

	/** Load the catalog and the remembered selection, then activate it. Idempotent. */
	async init(): Promise<void> {
		await this.refresh();
		const remembered = await readSelected().catch(() => null);
		const known = remembered && this.available.some((l) => l.name === remembered);
		this.load(known ? remembered : this.name);
	}

	/** Re-read the catalog of available lexicons (after a create/delete). */
	async refresh(): Promise<void> {
		this.available = await listLexicons().catch(() => this.available);
	}

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

	/** Switch lexicons and remember the choice for next launch. */
	select(name: string): void {
		if (name === this.name && (this.engine || this.error)) return;
		this.load(name);
		void writeSelected(name);
	}

	/** Drop a deleted custom lexicon, falling back to the default if it was active. */
	async forget(name: string): Promise<void> {
		evictLexicon(name);
		await this.refresh();
		if (this.name === name) this.select(DEFAULT_LEXICON);
	}
}

export const lexicon = new LexiconStore();
