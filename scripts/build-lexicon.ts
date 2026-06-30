// Build a bundled lexicon artifact from a `WORD<TAB>definition` word list.
//
//   bun scripts/build-lexicon.ts [name] [--source <path>]
//
// Everything except the definition is derived from the word list itself:
// alphagrams, hooks, point values, counts, and draw probability (combinatorics).
// Playability needs a separate play-count file and is left null for now.
// Output: a clean canonical SQLite DB at static/lexicons/<name>.db.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { alphabetForLexicon } from '../src/lib/lexicon/alphabets.ts';
import { buildRows, parseSource, CANONICAL_SCHEMA, COLUMN_ORDER } from '../src/lib/lexicon/build.ts';

const sourcePath = (file: string) => join(import.meta.dir, '..', 'data', 'sources', file);

const DEFAULT_SOURCES: Record<string, string> = {
	CSW24: sourcePath('csw24.tsv'),
	NWL23: sourcePath('nwl23.tsv'),
	FRA24: sourcePath('fra24.tsv')
};

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

	console.log('Deriving columns and ranking words by probability within each length...');
	const { rows, skipped } = buildRows(alphabet, parsed);
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
