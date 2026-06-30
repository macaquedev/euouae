// UI-facing description of every search condition: enough metadata to render the
// builder generically, so adding a condition is one entry here plus its SQL in
// SqliteLexiconEngine — never a new branch of markup.

import type { RangeField, SearchCondition, StringField } from '$lib/lexicon';

interface RangeMeta {
	kind: 'range';
	type: RangeField;
	label: string;
	minBound: number;
	maxBound: number;
}

interface StringMeta {
	kind: 'string';
	type: StringField;
	label: string;
	placeholder: string;
	negatable: boolean;
}

export type ConditionMeta = RangeMeta | StringMeta;

// Longest valid Scrabble word; bounds the numeric spinners sensibly.
const MAX_WORD_LENGTH = 15;

export const CONDITION_TYPES: readonly ConditionMeta[] = [
	{ kind: 'string', type: 'pattern', label: 'Pattern', placeholder: 'C?T or B*[AEIOU]', negatable: true },
	{
		kind: 'string',
		type: 'anagram',
		label: 'Anagram of',
		placeholder: 'AEINR?[ST]* (? = blank, [..] = one of, * = any)',
		negatable: false
	},
	{
		kind: 'string',
		type: 'subanagram',
		label: 'Subanagram of',
		placeholder: 'RETINA?[ST] (? = blank, [..] = one of)',
		negatable: false
	},
	{ kind: 'string', type: 'includeLetters', label: 'Includes letters', placeholder: 'QZ', negatable: true },
	{ kind: 'string', type: 'definition', label: 'Definition contains', placeholder: 'bird', negatable: true },
	{ kind: 'string', type: 'partOfSpeech', label: 'Part of speech', placeholder: 'n', negatable: true },
	{ kind: 'range', type: 'length', label: 'Length', minBound: 1, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'numVowels', label: 'Number of vowels', minBound: 0, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'numUniqueLetters', label: 'Unique letters', minBound: 1, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'pointValue', label: 'Point value', minBound: 0, maxBound: 100 },
	{ kind: 'range', type: 'numAnagrams', label: 'Number of anagrams', minBound: 1, maxBound: 20 },
	{ kind: 'range', type: 'probabilityOrder', label: 'Probability rank', minBound: 1, maxBound: 100000 }
];

/** The two condition groups, partitioned once for the builder's grouped picker. */
export const STRING_CONDITIONS = CONDITION_TYPES.filter((c) => c.kind === 'string');
export const RANGE_CONDITIONS = CONDITION_TYPES.filter((c) => c.kind === 'range');

const META_BY_TYPE = new Map(CONDITION_TYPES.map((meta) => [meta.type, meta]));

export function metaFor(type: RangeField | StringField): ConditionMeta {
	const meta = META_BY_TYPE.get(type);
	if (!meta) throw new Error(`Unknown condition type: ${type}`);
	return meta;
}

/** A fresh condition with sensible defaults for the given metadata. */
export function defaultCondition(meta: ConditionMeta): SearchCondition {
	return meta.kind === 'range'
		? { kind: 'range', type: meta.type, min: meta.minBound, max: meta.maxBound }
		: { kind: 'string', type: meta.type, value: '', negated: false };
}
