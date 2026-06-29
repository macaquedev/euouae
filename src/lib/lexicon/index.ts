import { base } from '$app/paths';
import { openSerializedDb } from './sqlite';
import { SqliteLexiconEngine } from './SqliteLexiconEngine';
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

/** Load a bundled lexicon by name, reusing the in-flight/loaded instance. */
export function loadLexicon(name: string = DEFAULT_LEXICON): Promise<LexiconEngine> {
	let engine = engines.get(name);
	if (!engine) {
		engine = (async () => {
			const db = await openSerializedDb(`${base}/lexicons/${name}.db`);
			return new SqliteLexiconEngine(name, db);
		})();
		engines.set(name, engine);
	}
	return engine;
}
