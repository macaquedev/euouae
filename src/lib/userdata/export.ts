// Word-list export, faithful to Collins/NASPA Zyzzyva's "Save Word List" feature.
// Four output formats and a set of orderable per-word attributes; the dialog in
// ExportDialog.svelte drives the choices and this module does the formatting.
//
// Reference: Zyzzyva's WordTableView::exportFile / getExportStrings.

import type { LexiconEngine, WordEntry } from '$lib/lexicon/types';

export type ExportFormat =
	| 'one-per-line'
	| 'question-answer'
	| 'two-column'
	| 'distinct-alphagrams';

export type ExportAttribute =
	| 'word'
	| 'definition'
	| 'front-hooks'
	| 'back-hooks'
	| 'inner-hooks'
	| 'lexicon-symbols'
	| 'probability-order'
	| 'playability-order'
	| 'alphagram';

export const FORMAT_LABELS: Record<ExportFormat, string> = {
	'one-per-line': 'One Word Per Line',
	'question-answer': 'Anagram Question/Answer',
	'two-column': 'Anagram Two Column',
	'distinct-alphagrams': 'Distinct Alphagrams'
};

export const ATTRIBUTE_LABELS: Record<ExportAttribute, string> = {
	word: 'Word',
	definition: 'Definition',
	'front-hooks': 'Front Hooks',
	'back-hooks': 'Back Hooks',
	'inner-hooks': 'Inner Hooks',
	'lexicon-symbols': 'Lexicon Symbols',
	'probability-order': 'Probability Order',
	'playability-order': 'Playability Order',
	alphagram: 'Alphagram'
};

/** Attributes in the order the picker offers them; Word is selected by default. */
export const ALL_ATTRIBUTES: readonly ExportAttribute[] = [
	'word',
	'definition',
	'front-hooks',
	'back-hooks',
	'inner-hooks',
	'lexicon-symbols',
	'probability-order',
	'playability-order',
	'alphagram'
];

export const FORMATS: readonly ExportFormat[] = [
	'one-per-line',
	'question-answer',
	'two-column',
	'distinct-alphagrams'
];

/** The alphagram-grouped formats ignore the attribute selection entirely. */
export function formatUsesAttributes(format: ExportFormat): boolean {
	return format !== 'distinct-alphagrams';
}

// Zyzzyva marks a word that is itself a hook of a longer word (inner hook) with a
// middle dot on the relevant side; absent sides get a space so columns stay aligned.
const PARENT_HOOK_CHAR = '·';
const TWO_COLUMN_ANAGRAM_PADDING = 3;

function alphagramOf(word: string): string {
	return [...word].sort().join('');
}

function lettersOnly(s: string): string {
	return s.replace(/[^A-Za-z]/g, '');
}

function num(n: number | null | undefined): string {
	return n == null ? '' : String(n);
}

/** Lexicon membership symbols. Empty until the app carries multi-lexicon data. */
function lexiconSymbols(_entry: WordEntry | undefined): string {
	return '';
}

function wordField(
	word: string,
	entry: WordEntry | undefined,
	innerHooks: boolean,
	symbols: boolean
): string {
	let str = word;
	if (innerHooks) {
		const front = entry?.isFrontHook ? PARENT_HOOK_CHAR : ' ';
		const back = entry?.isBackHook ? PARENT_HOOK_CHAR : ' ';
		str = front + str + back;
	}
	if (symbols) str += lexiconSymbols(entry);
	return str;
}

// The fields a single word contributes, in attribute order. Inner Hooks and
// Lexicon Symbols are modifiers on the Word field, not columns of their own, so
// they add no entry here — matching Zyzzyva.
function fieldsFor(
	word: string,
	entry: WordEntry | undefined,
	attributes: readonly ExportAttribute[]
): string[] {
	const innerHooks = attributes.includes('inner-hooks');
	const symbols = attributes.includes('lexicon-symbols');
	const fields: string[] = [];
	for (const attr of attributes) {
		switch (attr) {
			case 'word':
				fields.push(wordField(word, entry, innerHooks, symbols));
				break;
			case 'alphagram':
				fields.push(entry?.alphagram ?? alphagramOf(word));
				break;
			case 'definition':
				fields.push((entry?.definition ?? '').replace(/\n/g, ' / '));
				break;
			case 'front-hooks':
				fields.push(lettersOnly(entry?.frontHooks ?? ''));
				break;
			case 'back-hooks':
				fields.push(lettersOnly(entry?.backHooks ?? ''));
				break;
			case 'probability-order':
				fields.push(num(entry?.probabilityOrder?.[0]));
				break;
			case 'playability-order':
				fields.push(num(entry?.playabilityOrder));
				break;
			case 'inner-hooks':
			case 'lexicon-symbols':
				break;
		}
	}
	return fields;
}

interface Row {
	word: string;
	entry: WordEntry | undefined;
}

function groupByAlphagram(rows: Row[]): Map<string, Row[]> {
	const groups = new Map<string, Row[]>();
	for (const row of rows) {
		const key = row.entry?.alphagram ?? alphagramOf(row.word);
		const bucket = groups.get(key);
		if (bucket) bucket.push(row);
		else groups.set(key, [row]);
	}
	return groups;
}

function leftJustify(s: string, width: number): string {
	return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Build the export text for a list of words. Mirrors Zyzzyva's output exactly. */
export function buildExport(
	words: readonly string[],
	engine: LexiconEngine | null,
	format: ExportFormat,
	attributes: readonly ExportAttribute[]
): string {
	const rows: Row[] = words.map((word) => ({ word, entry: engine?.lookup(word) }));

	if (format === 'one-per-line') {
		return rows.map((r) => fieldsFor(r.word, r.entry, attributes).join('\t')).join('\n') + '\n';
	}

	const groups = groupByAlphagram(rows);
	const keys = [...groups.keys()].sort();

	if (format === 'distinct-alphagrams') {
		return keys.join('\n') + '\n';
	}

	if (format === 'question-answer') {
		let out = '';
		for (const key of keys) {
			out += `Q: ${key}\n`;
			for (const row of groups.get(key)!) {
				out += `A: ${fieldsFor(row.word, row.entry, attributes).join(' ')}\n`;
			}
			out += '\n';
		}
		return out;
	}

	// two-column: alphagram in the left column, then each anagram's fields padded
	// to per-column widths so everything lines up.
	const fieldsByKey = new Map<string, string[][]>();
	let fieldCount = 0;
	for (const key of keys) {
		const lines = groups.get(key)!.map((r) => fieldsFor(r.word, r.entry, attributes));
		fieldsByKey.set(key, lines);
		if (lines.length) fieldCount = lines[0].length;
	}

	const columnWidths = new Array<number>(fieldCount).fill(0);
	let anagramWidth = 0;
	for (const key of keys) {
		anagramWidth = Math.max(anagramWidth, key.length);
		for (const line of fieldsByKey.get(key)!) {
			for (let i = 0; i < fieldCount; i++) {
				columnWidths[i] = Math.max(columnWidths[i], line[i].length);
			}
		}
	}
	for (let i = 0; i < fieldCount; i++) columnWidths[i]++;
	anagramWidth += TWO_COLUMN_ANAGRAM_PADDING;

	const pad = ' '.repeat(anagramWidth);
	let out = '';
	for (const key of keys) {
		let first = true;
		for (const line of fieldsByKey.get(key)!) {
			out += first ? leftJustify(key, anagramWidth) : pad;
			first = false;
			for (let i = 0; i < line.length; i++) out += leftJustify(line[i], columnWidths[i]);
			out += '\n';
		}
	}
	return out;
}
