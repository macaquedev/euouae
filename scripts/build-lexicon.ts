// Build a bundled lexicon artifact from a `WORD<TAB>definition` word list.
//
//   bun scripts/build-lexicon.ts [name] [--source <path>]
//
// Everything except the definition is derived from the word list itself:
// alphagrams, hooks, point values, counts, and draw probability (combinatorics).
// Playability needs a separate play-count file and is left null for now.
// Output: a clean canonical SQLite DB at static/lexicons/<name>.db.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { alphabetForLexicon } from '../src/lib/lexicon/alphabets.ts';
import type { Alphabet } from '../src/lib/lexicon/alphabet.ts';
import {
	buildRows,
	parseSource,
	CANONICAL_SCHEMA,
	COLUMN_ORDER,
	type PredefinedSetData
} from '../src/lib/lexicon/build.ts';

const sourcePath = (file: string) => join(import.meta.dir, '..', 'data', 'sources', file);

const DEFAULT_SOURCES: Record<string, string> = {
	CSW24: sourcePath('csw24.tsv'),
	NWL23: sourcePath('nwl23.tsv'),
	FRA24: sourcePath('fra24.tsv')
};

// Each dictionary family curates its own "Top 100 Stems" — CSW's (Collins-branch
// Zyzzyva) and NWL's (legacy/NASPA-branch Zyzzyva) stem research differ, so each
// gets its own file rather than reusing the other's.
const STEM_SOURCES: Record<string, { six: string; seven: string } | undefined> = {
	CSW24: { six: sourcePath('csw-6-letter-stems.txt'), seven: sourcePath('csw-7-letter-stems.txt') },
	NWL23: { six: sourcePath('nwl-6-letter-stems.txt'), seven: sourcePath('nwl-7-letter-stems.txt') }
};

/**
 * One entry per line — either a bare alphagram (CSW's files) or a full word
 * (NWL's files); `alphabet.alphagram()` re-sorts either into the same
 * canonical form, so one loader handles both formats.
 */
async function loadStemAlphagrams(alphabet: Alphabet, path: string): Promise<Set<string> | undefined> {
	if (!existsSync(path)) return undefined;
	const lines = (await Bun.file(path).text()).split('\n').map((l) => l.trim()).filter(Boolean);
	return new Set(lines.map((l) => alphabet.alphagram(l.toUpperCase())));
}

function parseArgs(argv: string[]) {
	const positional: string[] = [];
	let source: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--source') source = argv[++i];
		else positional.push(argv[i]);
	}
	const name = positional[0] ?? 'CSW24';
	return { name, source: source ?? DEFAULT_SOURCES[name] };
}

async function main() {
	const { name, source } = parseArgs(process.argv.slice(2));
	console.log(`Building lexicon "${name}" from ${source}`);

	const alphabet = alphabetForLexicon(name);
	console.log(`Using the ${alphabet.name} tile set.`);

	const parsed = parseSource(await Bun.file(source).text());
	console.log(`Parsed ${parsed.length.toLocaleString()} words.`);

	// Type II/III Sevens & Eights are pure English-tile-set arithmetic (point
	// values, draw combinations) — true of the tile set itself, so they apply
	// unprompted to every English lexicon (buildRows no-ops them for French).
	// Type I Sevens/Eights and Eights-from-Seven-Stems need each dictionary's
	// own stem research (see STEM_SOURCES) — French has none, so gets neither.
	const predefined: PredefinedSetData = {};
	const stems = STEM_SOURCES[name];
	if (stems) {
		predefined.sixLetterStems = await loadStemAlphagrams(alphabet, stems.six);
		predefined.sevenLetterStems = await loadStemAlphagrams(alphabet, stems.seven);
	}

	console.log('Deriving columns and ranking words by probability within each length...');
	const { rows, skipped } = await buildRows(alphabet, parsed, {}, predefined);
	if (skipped > 0) {
		console.warn(
			`Warning: dropped ${skipped.toLocaleString()} word(s) containing a character outside the ${alphabet.name} tile set.`
		);
	}

	const outPath = join(import.meta.dir, '..', 'static', 'lexicons', `${name}.db`);
	mkdirSync(dirname(outPath), { recursive: true });
	const out = new Database(outPath, { create: true });
	out.exec('DROP TABLE IF EXISTS words;');
	out.exec(CANONICAL_SCHEMA);

	const placeholders = COLUMN_ORDER.map((c) => `$${c}`).join(',');
	const insert = out.prepare(`INSERT INTO words VALUES (${placeholders})`);
	const writeAll = out.transaction((items: typeof rows) => {
		for (const row of items) {
			insert.run(Object.fromEntries(COLUMN_ORDER.map((c) => [`$${c}`, row[c]])));
		}
	});
	writeAll(rows);
	out.exec('VACUUM;');
	out.close();

	const sizeMb = (Bun.file(outPath).size / 1024 / 1024).toFixed(1);
	console.log(`\nWrote ${rows.length.toLocaleString()} words to ${outPath} (${sizeMb} MB).`);
}

main();
