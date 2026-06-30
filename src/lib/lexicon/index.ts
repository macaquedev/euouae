import { base } from '$app/paths';
import { openSerializedDb, openSerializedDbBytes } from './sqlite';
import { SqliteLexiconEngine } from './SqliteLexiconEngine';
import { isBundled, customLexiconBytes, lexiconInfo } from './registry';
import { alphabetForLexicon } from './alphabets';
import type { LexiconEngine } from './types';

export type {
	LexiconEngine,
	WordEntry,
	ByBlanks,
	BlankCount,
	RangeField,
	StringField,
	SearchCondition,
	SortColumn,
	SortDirection,
	SearchSort,
	SearchSpec,
	SearchResult,
	ColumnWidths,
	WordWindow
} from './types';

export const DEFAULT_LEXICON = 'CSW24';

const engines = new Map<string, Promise<LexiconEngine>>();

/** Load a lexicon by name (bundled static file or custom from app data), reusing
 *  the in-flight/loaded instance. */
export function loadLexicon(name: string = DEFAULT_LEXICON): Promise<LexiconEngine> {
	let engine = engines.get(name);
	if (!engine) {
		engine = (async () => {
			const [db, info] = await Promise.all([
				isBundled(name)
					? openSerializedDb(`${base}/lexicons/${name}.db`)
					: openSerializedDbBytes(await customLexiconBytes(name)),
				lexiconInfo(name)
			]);
			const alphabet = info?.alphabet ?? alphabetForLexicon(name);
			return new SqliteLexiconEngine(name, db, alphabet);
		})();
		engines.set(name, engine);
	}
	return engine;
}

/** Forget a cached engine so the next load re-reads it (e.g. after a delete). */
export function evictLexicon(name: string): void {
	engines.delete(name);
}
