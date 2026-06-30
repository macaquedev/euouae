// The catalog of lexicons the app can load: the bundled ones shipped as static
// `.db` files, plus any custom lexicons the user has built from their own word
// lists. Custom lexicons live in the Tauri app data directory alongside the user
// database — their `.db` files under `lexicons/`, and a small JSON manifest
// recording each one's tile set, word count, and creation time.

import {
	BaseDirectory,
	exists,
	mkdir,
	readFile,
	readTextFile,
	remove,
	writeFile,
	writeTextFile
} from '@tauri-apps/plugin-fs';
import { ALPHABETS, alphabetForLexicon } from './alphabets';
import { Alphabet, type AlphabetSpec } from './alphabet';

export type AlphabetKey = keyof typeof ALPHABETS;

/** How a custom lexicon's tile set is chosen: a built-in preset, or a
 *  self-contained tile set the user defined by hand. */
export type AlphabetChoice =
	| { readonly kind: 'preset'; readonly key: AlphabetKey }
	| { readonly kind: 'custom'; readonly spec: AlphabetSpec };

const BASE = BaseDirectory.AppData;
const DIR = 'lexicons';
const MANIFEST = `${DIR}/custom.json`;
const customPath = (name: string) => `${DIR}/${name}.db`;

/** A lexicon's place in the catalog, resolved to its tile set. */
export interface LexiconInfo {
	readonly name: string;
	readonly kind: 'bundled' | 'custom';
	readonly alphabet: Alphabet;
	/** The preset tile set this lexicon uses, or undefined for a custom tile set. */
	readonly alphabetKey?: AlphabetKey;
	readonly wordCount?: number;
	readonly createdAt?: number;
}

interface CustomEntry {
	readonly name: string;
	/** A preset tile set by key (also how legacy entries were stored). */
	readonly alphabet?: AlphabetKey;
	/** A self-contained custom tile set; takes precedence over `alphabet`. */
	readonly spec?: AlphabetSpec;
	readonly wordCount: number;
	readonly createdAt: number;
}

// The lexicons that ship with the app, in display order. Each maps to a tile set
// via alphabetForLexicon (see alphabets.ts).
const BUNDLED_NAMES = ['CSW24', 'NWL23', 'FRA24'] as const;

export const BUNDLED: ReadonlyArray<LexiconInfo> = BUNDLED_NAMES.map((name) => ({
	name,
	kind: 'bundled',
	alphabet: alphabetForLexicon(name),
	alphabetKey: alphabetKeyOf(alphabetForLexicon(name))
}));

const bundledNameSet = new Set<string>(BUNDLED_NAMES);
export const isBundled = (name: string): boolean => bundledNameSet.has(name);

/** Find the registry key (ENGLISH, FRENCH, …) for an alphabet instance. */
function alphabetKeyOf(alphabet: Alphabet): AlphabetKey {
	const key = (Object.keys(ALPHABETS) as AlphabetKey[]).find((k) => ALPHABETS[k] === alphabet);
	return key ?? 'ENGLISH';
}

async function readManifest(): Promise<CustomEntry[]> {
	if (!(await exists(MANIFEST, { baseDir: BASE }))) return [];
	try {
		const parsed = JSON.parse(await readTextFile(MANIFEST, { baseDir: BASE }));
		return Array.isArray(parsed) ? (parsed as CustomEntry[]) : [];
	} catch {
		return [];
	}
}

async function writeManifest(entries: CustomEntry[]): Promise<void> {
	await mkdir(DIR, { baseDir: BASE, recursive: true }).catch(() => {});
	await writeTextFile(MANIFEST, JSON.stringify(entries, null, 2), { baseDir: BASE });
}

function toInfo(entry: CustomEntry): LexiconInfo {
	if (entry.spec) {
		return {
			name: entry.name,
			kind: 'custom',
			alphabet: new Alphabet(entry.spec),
			wordCount: entry.wordCount,
			createdAt: entry.createdAt
		};
	}
	const known = entry.alphabet && ALPHABETS[entry.alphabet] ? entry.alphabet : 'ENGLISH';
	return {
		name: entry.name,
		kind: 'custom',
		alphabet: ALPHABETS[known],
		alphabetKey: known,
		wordCount: entry.wordCount,
		createdAt: entry.createdAt
	};
}

/** Every custom lexicon, newest first. */
export async function customLexicons(): Promise<LexiconInfo[]> {
	const entries = await readManifest();
	return entries.map(toInfo).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** The full catalog: bundled lexicons followed by the user's custom ones. */
export async function listLexicons(): Promise<LexiconInfo[]> {
	return [...BUNDLED, ...(await customLexicons())];
}

/** Resolve one lexicon by name (bundled or custom), or undefined if unknown. */
export async function lexiconInfo(name: string): Promise<LexiconInfo | undefined> {
	return (await listLexicons()).find((l) => l.name === name);
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

/** Validate a proposed custom-lexicon name against existing names + the rules. */
export async function validateName(name: string): Promise<string | null> {
	const trimmed = name.trim();
	if (!trimmed) return 'Enter a name.';
	if (!NAME_PATTERN.test(trimmed)) {
		return 'Use letters, numbers, spaces, hyphens or underscores (max 40).';
	}
	if (isBundled(trimmed)) return `"${trimmed}" is a built-in lexicon name.`;
	if ((await readManifest()).some((e) => e.name === trimmed)) {
		return `A custom lexicon named "${trimmed}" already exists.`;
	}
	return null;
}

/** Write a freshly built custom lexicon's bytes and record it in the manifest. */
export async function saveCustomLexicon(
	name: string,
	choice: AlphabetChoice,
	bytes: Uint8Array,
	wordCount: number
): Promise<LexiconInfo> {
	await mkdir(DIR, { baseDir: BASE, recursive: true }).catch(() => {});
	await writeFile(customPath(name), bytes, { baseDir: BASE });
	const createdAt = Date.now();
	const entry: CustomEntry =
		choice.kind === 'preset'
			? { name, alphabet: choice.key, wordCount, createdAt }
			: { name, spec: choice.spec, wordCount, createdAt };
	const entries = (await readManifest()).filter((e) => e.name !== name);
	entries.push(entry);
	await writeManifest(entries);
	return toInfo(entry);
}

/** Remove a custom lexicon's file and manifest entry (bundled names are ignored). */
export async function deleteCustomLexicon(name: string): Promise<void> {
	if (isBundled(name)) return;
	const entries = (await readManifest()).filter((e) => e.name !== name);
	await writeManifest(entries);
	if (await exists(customPath(name), { baseDir: BASE })) {
		await remove(customPath(name), { baseDir: BASE });
	}
}

/** The stored bytes of a custom lexicon, for opening it into the engine. */
export async function customLexiconBytes(name: string): Promise<Uint8Array> {
	return readFile(customPath(name), { baseDir: BASE });
}
