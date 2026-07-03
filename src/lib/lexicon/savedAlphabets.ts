// The user's library of saved tile sets ("alphabets"): custom bags they've built
// or imported, kept so they can be reused across lexicons, shared as files, and
// carried in a progress backup. Each is a self-contained AlphabetSpec. They live
// in app-data storage (Tauri data dir or browser OPFS — see platform/storage.ts)
// as one small JSON file alongside the custom-lexicon manifest.
//
// This is deliberately separate from a lexicon's own tile set: a custom lexicon
// still bakes its bag into its own manifest entry (so it keeps working even if a
// saved set is later deleted). Saving to this library is what makes a bag a
// reusable thing rather than a one-off inside a single lexicon.

import { readTextFile, writeTextFile, exists, removeFile } from '$lib/platform/storage';
import { ALPHABETS } from './alphabets';
import { Alphabet, type AlphabetSpec } from './alphabet';

export const SAVED_ALPHABETS_FILE = 'lexicons/alphabets.json';

/** Longest a tile-set name may be — matches the builder's rename field. */
const MAX_NAME = 40;

interface SavedEntry {
	readonly spec: AlphabetSpec;
	readonly createdAt: number;
}

/** A saved tile set resolved for use: its spec plus a ready Alphabet instance. */
export interface SavedAlphabet {
	readonly name: string;
	readonly spec: AlphabetSpec;
	readonly alphabet: Alphabet;
	readonly createdAt: number;
}

/** Preset tile-set names, lowercased — reserved so a saved set can't shadow one. */
const presetNames = new Set(Object.values(ALPHABETS).map((a) => a.name.toLowerCase()));

async function readEntries(): Promise<SavedEntry[]> {
	if (!(await exists(SAVED_ALPHABETS_FILE))) return [];
	try {
		const parsed = JSON.parse(await readTextFile(SAVED_ALPHABETS_FILE));
		return Array.isArray(parsed) ? (parsed as SavedEntry[]) : [];
	} catch {
		return [];
	}
}

async function writeEntries(entries: SavedEntry[]): Promise<void> {
	await writeTextFile(SAVED_ALPHABETS_FILE, JSON.stringify(entries, null, 2));
}

const toSaved = (entry: SavedEntry): SavedAlphabet => ({
	name: entry.spec.name,
	spec: entry.spec,
	alphabet: new Alphabet(entry.spec),
	createdAt: entry.createdAt
});

/** Every saved tile set, newest first. */
export async function listSavedAlphabets(): Promise<SavedAlphabet[]> {
	const entries = await readEntries();
	return entries.map(toSaved).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Reject a proposed tile-set name: empty, over length, clashing with a built-in
 * preset, or already taken by another saved set. `existing` is the names already
 * in the library the caller wants to check against — pass it minus the set being
 * renamed so a set keeps its own name. Returns an error string, or null if ok.
 */
export function validateAlphabetName(name: string, existing: Iterable<string>): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'Enter a name.';
	if (trimmed.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;
	if (presetNames.has(trimmed.toLowerCase())) return `“${trimmed}” is a built-in tile set.`;
	const taken = new Set([...existing].map((n) => n.toLowerCase()));
	if (taken.has(trimmed.toLowerCase())) return `A tile set named “${trimmed}” already exists.`;
	return null;
}

/**
 * Store a tile set, replacing any existing one with the same name (an edit) —
 * the caller validates the name first for a create, but an upsert on save keeps
 * "save the set I'm editing" simple. Returns the stored form.
 */
export async function saveAlphabet(spec: AlphabetSpec): Promise<SavedAlphabet> {
	const entries = await readEntries();
	const existing = entries.find((e) => e.spec.name === spec.name);
	const createdAt = existing?.createdAt ?? Date.now();
	const next = entries.filter((e) => e.spec.name !== spec.name);
	next.push({ spec, createdAt });
	await writeEntries(next);
	return toSaved({ spec, createdAt });
}

/** Remove a saved tile set by name (a no-op if it isn't there). */
export async function deleteSavedAlphabet(name: string): Promise<void> {
	const entries = await readEntries();
	const next = entries.filter((e) => e.spec.name !== name);
	if (next.length === entries.length) return;
	if (next.length === 0 && (await exists(SAVED_ALPHABETS_FILE))) {
		await removeFile(SAVED_ALPHABETS_FILE);
		return;
	}
	await writeEntries(next);
}

/** Rename a saved tile set, keeping its creation time and place in the library. */
export async function renameSavedAlphabet(oldName: string, newName: string): Promise<void> {
	const entries = await readEntries();
	const idx = entries.findIndex((e) => e.spec.name === oldName);
	if (idx === -1) return;
	const entry = entries[idx];
	entries[idx] = { spec: { ...entry.spec, name: newName.trim() }, createdAt: entry.createdAt };
	await writeEntries(entries);
}

/**
 * Fold saved tile sets carried by a progress backup into this device's library:
 * add ones whose name isn't already taken locally, keep the local copy on a
 * clash. Idempotent. `json` is the backup's alphabets.json text, if it had one.
 */
export async function importSavedAlphabets(
	json: string | undefined
): Promise<{ added: string[]; skipped: string[] }> {
	const added: string[] = [];
	const skipped: string[] = [];
	if (!json) return { added, skipped };

	let incoming: SavedEntry[];
	try {
		const parsed = JSON.parse(json);
		incoming = Array.isArray(parsed) ? (parsed as SavedEntry[]) : [];
	} catch {
		return { added, skipped };
	}

	const local = await readEntries();
	const taken = new Set(local.map((e) => e.spec.name));
	const toAdd: SavedEntry[] = [];
	for (const entry of incoming) {
		const name = entry?.spec?.name;
		if (!name) continue;
		if (taken.has(name)) {
			skipped.push(name);
			continue;
		}
		taken.add(name);
		toAdd.push(entry);
		added.push(name);
	}
	if (toAdd.length) await writeEntries([...local, ...toAdd]);
	return { added, skipped };
}
