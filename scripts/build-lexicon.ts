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
import {
	alphagram,
	pointValue,
	vowelCount,
	uniqueLetterCount,
	frontHooks,
	backHooks
} from '../src/lib/lexicon/letters.ts';
import { combinations, probabilityOrders } from '../src/lib/lexicon/probability.ts';
import type { ByBlanks } from '../src/lib/lexicon/types.ts';

const DEFAULT_SOURCES: Record<string, string> = {
	CSW24: join(import.meta.dir, '..', 'data', 'sources', 'csw24.tsv')
};

interface ParsedEntry {
	readonly word: string;
	readonly definition: string;
	readonly partOfSpeech: string; // comma-joined, e.g. "n,v"
}

interface BuiltEntry extends ParsedEntry {
	readonly length: number;
	readonly alphagram: string;
	readonly combinations: ByBlanks;
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

/** Pull part-of-speech codes from the `[n -S]` / `[v ...]` brackets, in order. */
function extractPartOfSpeech(definition: string): string {
	const tags: string[] = [];
	for (const match of definition.matchAll(/\[([a-z]+)/g)) {
		if (!tags.includes(match[1])) tags.push(match[1]);
	}
	return tags.join(',');
}

function parseSource(text: string): ParsedEntry[] {
	const entries: ParsedEntry[] = [];
	for (const line of text.split('\n')) {
		if (line === '' || line.startsWith('#')) continue;
		const tab = line.indexOf('\t');
		const word = (tab === -1 ? line : line.slice(0, tab)).trim();
		if (word === '') continue;
		const definition = tab === -1 ? '' : line.slice(tab + 1).trim();
		entries.push({ word, definition, partOfSpeech: extractPartOfSpeech(definition) });
	}
	return entries;
}

const CANONICAL_SCHEMA = `
CREATE TABLE words (
  word TEXT PRIMARY KEY,
  length INTEGER NOT NULL,
  alphagram TEXT NOT NULL,
  point_value INTEGER NOT NULL,
  num_anagrams INTEGER NOT NULL,
  num_unique_letters INTEGER NOT NULL,
  num_vowels INTEGER NOT NULL,
  front_hooks TEXT NOT NULL,
  back_hooks TEXT NOT NULL,
  is_front_hook INTEGER NOT NULL,
  is_back_hook INTEGER NOT NULL,
  combinations0 INTEGER NOT NULL,
  combinations1 INTEGER NOT NULL,
  combinations2 INTEGER NOT NULL,
  probability_order0 INTEGER NOT NULL,
  probability_order1 INTEGER NOT NULL,
  probability_order2 INTEGER NOT NULL,
  playability REAL,
  playability_order INTEGER,
  part_of_speech TEXT NOT NULL,
  definition TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_alphagram ON words(alphagram);
CREATE INDEX idx_length ON words(length);
CREATE INDEX idx_prob0 ON words(length, probability_order0);
`;

async function main() {
	const { name, source } = parseArgs(process.argv.slice(2));
	console.log(`Building lexicon "${name}" from ${source}`);

	const parsed = parseSource(await Bun.file(source).text());
	console.log(`Parsed ${parsed.length.toLocaleString()} words.`);

	const wordSet = new Set(parsed.map((e) => e.word));
	const isWord = (w: string) => wordSet.has(w);

	const groupSize = new Map<string, number>();
	const built: BuiltEntry[] = parsed.map((e) => {
		const gram = alphagram(e.word);
		groupSize.set(gram, (groupSize.get(gram) ?? 0) + 1);
		return { ...e, length: e.word.length, alphagram: gram, combinations: combinations(e.word) };
	});

	console.log('Ranking words by probability within each length...');
	const orders = probabilityOrders(built);

	const outPath = join(import.meta.dir, '..', 'static', 'lexicons', `${name}.db`);
	mkdirSync(dirname(outPath), { recursive: true });
	const out = new Database(outPath, { create: true });
	out.exec('DROP TABLE IF EXISTS words;');
	out.exec(CANONICAL_SCHEMA);

	const insert = out.prepare(`INSERT INTO words VALUES (
    $word,$length,$alphagram,$point_value,$num_anagrams,$num_unique_letters,$num_vowels,
    $front_hooks,$back_hooks,$is_front_hook,$is_back_hook,
    $combinations0,$combinations1,$combinations2,
    $probability_order0,$probability_order1,$probability_order2,
    $playability,$playability_order,$part_of_speech,$definition)`);

	const writeAll = out.transaction((items: BuiltEntry[]) => {
		for (const e of items) {
			const order = orders.get(e.word)!;
			insert.run({
				$word: e.word,
				$length: e.length,
				$alphagram: e.alphagram,
				$point_value: pointValue(e.word),
				$num_anagrams: groupSize.get(e.alphagram)!,
				$num_unique_letters: uniqueLetterCount(e.word),
				$num_vowels: vowelCount(e.word),
				$front_hooks: frontHooks(e.word, isWord),
				$back_hooks: backHooks(e.word, isWord),
				$is_front_hook: Number(isWord(e.word.slice(1))),
				$is_back_hook: Number(isWord(e.word.slice(0, -1))),
				$combinations0: e.combinations[0],
				$combinations1: e.combinations[1],
				$combinations2: e.combinations[2],
				$probability_order0: order[0],
				$probability_order1: order[1],
				$probability_order2: order[2],
				$playability: null,
				$playability_order: null,
				$part_of_speech: e.partOfSpeech,
				$definition: e.definition
			});
		}
	});
	writeAll(built);
	out.exec('VACUUM;');
	out.close();

	const sizeMb = (Bun.file(outPath).size / 1024 / 1024).toFixed(1);
	console.log(`\nWrote ${built.length.toLocaleString()} words to ${outPath} (${sizeMb} MB).`);
}

main();
