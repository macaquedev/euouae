// The editable form of a tile set, shared by everything that lets the user shape
// one by hand: the lexicon builder's bag editor, the standalone tile-set manager,
// and the import/export file format. A `DraftTile` is a loose, mid-edit tile (its
// glyph may be blank or lowercase while typing); `specFromDraft` freezes a
// validated draft into the immutable `AlphabetSpec` the engine and storage use.

import { Alphabet, type AlphabetSpec, type Tile } from './alphabet';

export interface DraftTile {
	glyph: string;
	value: number;
	frequency: number;
	vowel: boolean;
}

/** The portable tile-set file format written by exports and read by imports. */
export const TILESET_FORMAT = 'euouae-tilesets';
export const TILESET_VERSION = 1;
/** File extension for an exported tile set, e.g. `my-set.euouae-tiles.json`. */
export const TILESET_EXTENSION = 'json';

/** A tile's glyph as it's stored and compared: trimmed and uppercased. */
export const normalGlyph = (glyph: string): string => glyph.trim().toUpperCase();

/** An editable draft seeded from an existing alphabet (a preset or a saved set). */
export const draftFromAlphabet = (alphabet: Alphabet): DraftTile[] =>
	alphabet.tiles.map((t) => ({
		glyph: t.glyph,
		value: t.value,
		frequency: t.frequency,
		vowel: t.vowel
	}));

/**
 * The first problem with a draft tile set, or null when it's ready to build.
 * The single source of truth for "is this bag usable", so the builder, the
 * manager, and the file importer all reject the same things with the same words.
 */
export function validateTileSet(tiles: readonly DraftTile[], blankCount: number): string | null {
	if (tiles.length === 0) return 'Add at least one tile.';
	const seen = new Set<string>();
	for (const tile of tiles) {
		const glyph = normalGlyph(tile.glyph);
		if (!glyph) return 'Every tile needs a letter.';
		if (seen.has(glyph)) return `Duplicate tile “${glyph}”.`;
		seen.add(glyph);
		if (!Number.isInteger(tile.value) || tile.value < 0)
			return `“${glyph}” needs a point value of 0 or more.`;
		// 0 is allowed: a tile that's valid in the lexicon but absent from the
		// physical bag, playable only by spending a blank on it.
		if (!Number.isInteger(tile.frequency) || tile.frequency < 0)
			return `“${glyph}” needs a bag count of 0 or more.`;
	}
	if (!Number.isInteger(blankCount) || blankCount < 0) return 'Blanks must be 0 or more.';
	return null;
}

/** Freeze a (validated) draft into the immutable spec storage and the engine use. */
export function specFromDraft(
	name: string,
	tiles: readonly DraftTile[],
	blankCount: number
): AlphabetSpec {
	return {
		name: name.trim(),
		blankCount,
		tiles: tiles.map((t) => ({
			glyph: normalGlyph(t.glyph),
			value: t.value,
			frequency: t.frequency,
			vowel: t.vowel
		}))
	};
}

/** Total tiles in a full bag, blanks included — the "N in the bag" summary figure. */
export function bagCount(tiles: readonly DraftTile[], blankCount: number): number {
	const tileSum = tiles.reduce((sum, t) => sum + (Number.isFinite(t.frequency) ? t.frequency : 0), 0);
	return tileSum + (Number.isFinite(blankCount) ? blankCount : 0);
}

/** One-line description of a tile set, e.g. "26 tiles · 100 in the bag · 2 blanks". */
export function tileSetSummary(tiles: readonly DraftTile[], blankCount: number): string {
	const blanks = blankCount === 1 ? '1 blank' : `${blankCount} blanks`;
	return `${tiles.length} tiles · ${bagCount(tiles, blankCount)} in the bag · ${blanks}`;
}

/** Serialize one or more tile sets to the portable file format's JSON text. */
export function serializeTileSets(specs: readonly AlphabetSpec[]): string {
	return JSON.stringify(
		{ format: TILESET_FORMAT, version: TILESET_VERSION, tilesets: specs },
		null,
		2
	);
}

/** A file that doesn't parse as any tile-set shape we recognise. */
export class NotATileSetFile extends Error {
	constructor() {
		super('This file isn’t a euouae tile set.');
		this.name = 'NotATileSetFile';
	}
}

/**
 * Read tile sets out of an exported file's text — tolerant of a few shapes so a
 * hand-written or older file still loads: our `{ tilesets: [...] }` wrapper, a
 * single `{ tileset: {...} }`, a bare array of specs, or one bare spec. Every
 * candidate is normalised and run through `validateTileSet`, so a malformed set
 * fails here with the same message it would in the editor rather than being
 * imported broken.
 */
export function parseTileSetsFile(text: string): AlphabetSpec[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new NotATileSetFile();
	}

	const candidates = collectCandidates(data);
	if (candidates.length === 0) throw new NotATileSetFile();

	return candidates.map((raw, i) => {
		const spec = coerceSpec(raw, i);
		const error = validateTileSet(spec.tiles, spec.blankCount);
		if (error) throw new Error(`“${spec.name || `Tile set ${i + 1}`}”: ${error}`);
		return spec;
	});
}

function collectCandidates(data: unknown): unknown[] {
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') {
		const obj = data as Record<string, unknown>;
		if (Array.isArray(obj.tilesets)) return obj.tilesets;
		if (obj.tileset) return [obj.tileset];
		if (Array.isArray(obj.tiles)) return [obj]; // a bare spec
	}
	return [];
}

/** Coerce one loosely-typed tile set from a file into a clean spec (or throw). */
function coerceSpec(raw: unknown, index: number): AlphabetSpec {
	if (!raw || typeof raw !== 'object') throw new NotATileSetFile();
	const obj = raw as Record<string, unknown>;
	const name = typeof obj.name === 'string' ? obj.name.trim() : '';
	if (!name) throw new Error(`Tile set ${index + 1} is missing a name.`);
	if (!Array.isArray(obj.tiles)) throw new Error(`“${name}” has no tiles.`);

	const tiles: Tile[] = obj.tiles.map((t) => {
		const tile = (t ?? {}) as Record<string, unknown>;
		return {
			glyph: normalGlyph(String(tile.glyph ?? '')),
			value: Number(tile.value),
			frequency: Number(tile.frequency),
			vowel: Boolean(tile.vowel)
		};
	});
	const blankCount = obj.blankCount == null ? 0 : Number(obj.blankCount);
	return { name, tiles, blankCount };
}
