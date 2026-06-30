// The tile sets the app knows about. All four carry their authoritative
// distributions — English/French from the official Scrabble bags, Spanish/German
// verified tile-for-tile against liwords. No lexicon loads a tile set until a word
// list exists for it. See alphabet.ts for the mechanism.

import { Alphabet, type Tile } from './alphabet';

function tiles(vowels: string, table: Record<string, [value: number, frequency: number]>): Tile[] {
	const vowelSet = new Set(vowels.split(' '));
	return Object.entries(table).map(([glyph, [value, frequency]]) => ({
		glyph,
		value,
		frequency,
		vowel: vowelSet.has(glyph)
	}));
}

// English / Collins. Authoritative — these are the existing TILE_VALUES and
// TILE_FREQUENCIES, now in one place. Order A–Z is the collation order.
export const ENGLISH = new Alphabet({
	name: 'English',
	blankCount: 2,
	tiles: tiles('A E I O U', {
		A: [1, 9], B: [3, 2], C: [3, 2], D: [2, 4], E: [1, 12], F: [4, 2], G: [2, 3],
		H: [4, 2], I: [1, 9], J: [8, 1], K: [5, 1], L: [1, 4], M: [3, 2], N: [1, 6],
		O: [1, 8], P: [3, 2], Q: [10, 1], R: [1, 6], S: [1, 4], T: [1, 6], U: [1, 4],
		V: [4, 2], W: [4, 2], X: [8, 1], Y: [4, 2], Z: [10, 1]
	})
});

// Spanish (FISE). Authoritative distribution, verified tile-for-tile against
// liwords' `spanish` letter distribution. CH, LL and RR are single tiles, Ñ is its
// own letter, and there is no K or W. CH sorts after C, LL after L, RR after R.
export const SPANISH = new Alphabet({
	name: 'Spanish',
	blankCount: 2,
	tiles: tiles('A E I O U', {
		A: [1, 12], B: [3, 2], C: [3, 4], CH: [5, 1], D: [2, 5], E: [1, 12], F: [4, 1],
		G: [2, 2], H: [4, 2], I: [1, 6], J: [8, 1], L: [1, 4], LL: [8, 1], M: [3, 2],
		N: [1, 5], 'Ñ': [8, 1], O: [1, 9], P: [3, 2], Q: [5, 1], R: [1, 5], RR: [8, 1],
		S: [1, 6], T: [1, 4], U: [1, 5], V: [4, 1], X: [8, 1], Y: [4, 1], Z: [10, 1]
	})
});

// French (ODS). Authoritative distribution: the standard French Scrabble bag.
// Plain A–Z like English (accents are stripped from playable forms), but the
// point values and bag frequencies differ — K, W, X, Y, Z are worth 10, E is the
// most common tile (15), and J/Q are worth 8. Collation is A–Z, so French
// alphagrams match English ones and the existing engine handles it unchanged.
export const FRENCH = new Alphabet({
	name: 'French',
	blankCount: 2,
	tiles: tiles('A E I O U', {
		A: [1, 9], B: [3, 2], C: [3, 2], D: [2, 3], E: [1, 15], F: [4, 2], G: [2, 2],
		H: [4, 2], I: [1, 8], J: [8, 1], K: [10, 1], L: [1, 5], M: [2, 3], N: [1, 6],
		O: [1, 6], P: [3, 2], Q: [8, 1], R: [1, 6], S: [1, 6], T: [1, 6], U: [1, 6],
		V: [4, 2], W: [10, 1], X: [10, 1], Y: [10, 1], Z: [10, 1]
	})
});

// German. Authoritative distribution, verified tile-for-tile against liwords'
// `german` letter distribution. Ä, Ö and Ü are single tiles (single code points, so
// no multi-character tokenization needed), each collated right after its base vowel
// (Ä after A, Ö after O, Ü after U) to match liwords; there is no ß tile.
export const GERMAN = new Alphabet({
	name: 'German',
	blankCount: 2,
	tiles: tiles('A E I O U Ä Ö Ü', {
		A: [1, 5], 'Ä': [6, 1], B: [3, 2], C: [4, 2], D: [1, 4], E: [1, 15], F: [4, 2],
		G: [2, 3], H: [2, 4], I: [1, 6], J: [6, 1], K: [4, 2], L: [2, 3], M: [3, 4],
		N: [1, 9], O: [2, 3], 'Ö': [8, 1], P: [4, 1], Q: [10, 1], R: [1, 6], S: [1, 7],
		T: [1, 6], U: [1, 6], 'Ü': [6, 1], V: [6, 1], W: [3, 1], X: [8, 1], Y: [10, 1],
		Z: [3, 1]
	})
});

// Russian. The standard Russian Scrabble bag — 102 letter tiles + 2 blanks = 104.
// Every letter is a single Cyrillic code point (no multi-character tokenization),
// collated in Russian alphabet order А…Я; Ё sits after Е. Vowels are the ten
// А Е Ё И О У Ы Э Ю Я; Й (short i), Ь (soft sign) and Ъ (hard sign) are consonants.
export const RUSSIAN = new Alphabet({
	name: 'Russian',
	blankCount: 2,
	tiles: tiles('А Е Ё И О У Ы Э Ю Я', {
		'А': [1, 8], 'Б': [3, 2], 'В': [1, 4], 'Г': [3, 2], 'Д': [2, 4], 'Е': [1, 8],
		'Ё': [3, 1], 'Ж': [5, 1], 'З': [5, 2], 'И': [1, 5], 'Й': [4, 1], 'К': [2, 4],
		'Л': [2, 4], 'М': [2, 3], 'Н': [1, 5], 'О': [1, 10], 'П': [2, 4], 'Р': [1, 5],
		'С': [1, 5], 'Т': [1, 5], 'У': [2, 4], 'Ф': [10, 1], 'Х': [5, 1], 'Ц': [5, 1],
		'Ч': [5, 1], 'Ш': [8, 1], 'Щ': [10, 1], 'Ъ': [10, 1], 'Ы': [4, 2], 'Ь': [3, 2],
		'Э': [8, 1], 'Ю': [8, 1], 'Я': [3, 2]
	})
});

export const ALPHABETS: Readonly<Record<string, Alphabet>> = {
	ENGLISH,
	FRENCH,
	SPANISH,
	GERMAN,
	RUSSIAN
};

// Which tile set each bundled lexicon uses. A lexicon not listed here falls back
// to English. Register a new lexicon's alphabet alongside its word-list source.
const LEXICON_ALPHABETS: Readonly<Record<string, Alphabet>> = {
	CSW24: ENGLISH,
	NWL23: ENGLISH,
	FRA24: FRENCH
};

/** The alphabet a lexicon is built and queried with (English by default). */
export function alphabetForLexicon(name: string): Alphabet {
	return LEXICON_ALPHABETS[name] ?? ENGLISH;
}
