// UI-facing description of every search condition: enough metadata to render the
// builder generically, so adding a condition is one entry here plus its SQL in
// SqliteLexiconEngine — never a new branch of markup.

import type { RangeField, SearchCondition, StringField, WordSetField } from '$lib/lexicon';
export { MAX_WILD_SLOTS } from '$lib/lexicon';

interface RangeMeta {
	kind: 'range';
	type: RangeField;
	label: string;
	minBound: number;
	maxBound: number;
	/** Whether this field is computed per assumed blank count (0/1/2) — the
	 *  builder renders an extra "blanks" selector for these. */
	blankAware?: boolean;
}

interface StringMeta {
	kind: 'string';
	type: StringField;
	label: string;
	placeholder: string;
	negatable: boolean;
}

/** A fixed-choice condition: a `<select>` instead of free text, but still
 *  stored as a `kind: 'string'` SearchCondition (the option's `value`). */
interface ChoiceMeta {
	kind: 'choice';
	type: StringField;
	label: string;
	negatable: boolean;
	options: ReadonlyArray<{ value: string; label: string }>;
}

/** A saved word list or another lexicon, matched by exact membership. */
interface WordSetMeta {
	kind: 'wordSet';
	type: WordSetField;
	label: string;
	negatable: boolean;
}

export type ConditionMeta = RangeMeta | StringMeta | ChoiceMeta | WordSetMeta;

// Longest valid Scrabble word; bounds the numeric spinners sensibly.
const MAX_WORD_LENGTH = 15;

// "Belongs to group" option keys — compared against in SqliteLexiconEngine
// after the generic uppercase/whitespace-strip every string value gets, so
// these are already in that form.
export const GROUP_FRONT_HOOK = 'FRONTHOOK';
export const GROUP_BACK_HOOK = 'BACKHOOK';
export const GROUP_ANY_HOOK = 'ANYHOOK';
export const GROUP_HIGH_FIVE = 'HIGHFIVE';
export const GROUP_TYPE1_SEVEN = 'TYPE1SEVEN';
export const GROUP_TYPE2_SEVEN = 'TYPE2SEVEN';
export const GROUP_TYPE3_SEVEN = 'TYPE3SEVEN';
export const GROUP_TYPE1_EIGHT = 'TYPE1EIGHT';
export const GROUP_TYPE2_EIGHT = 'TYPE2EIGHT';
export const GROUP_TYPE3_EIGHT = 'TYPE3EIGHT';
export const GROUP_EIGHT_FROM_SEVEN_STEM = 'EIGHTFROMSEVENSTEM';

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
	{ kind: 'string', type: 'prefix', label: 'Starts with', placeholder: 'UN', negatable: true },
	{ kind: 'string', type: 'suffix', label: 'Ends with', placeholder: 'ING', negatable: true },
	{
		kind: 'string',
		type: 'consistOf',
		label: 'Consists of',
		placeholder: 'AEIOU or A2E1O1 (digits cap that letter’s count)',
		negatable: false
	},
	{ kind: 'string', type: 'definition', label: 'Definition contains', placeholder: 'bird', negatable: true },
	{ kind: 'string', type: 'partOfSpeech', label: 'Part of speech', placeholder: 'n', negatable: true },
	{
		kind: 'choice',
		type: 'group',
		label: 'Belongs to group',
		negatable: true,
		options: [
			{ value: GROUP_FRONT_HOOK, label: 'Front hooks' },
			{ value: GROUP_BACK_HOOK, label: 'Back hooks' },
			{ value: GROUP_ANY_HOOK, label: 'Hook words (front or back)' },
			{ value: GROUP_HIGH_FIVE, label: 'High fives' },
			{ value: GROUP_TYPE1_SEVEN, label: 'Type I sevens' },
			{ value: GROUP_TYPE2_SEVEN, label: 'Type II sevens' },
			{ value: GROUP_TYPE3_SEVEN, label: 'Type III sevens' },
			{ value: GROUP_TYPE1_EIGHT, label: 'Type I eights' },
			{ value: GROUP_TYPE2_EIGHT, label: 'Type II eights' },
			{ value: GROUP_TYPE3_EIGHT, label: 'Type III eights' },
			{ value: GROUP_EIGHT_FROM_SEVEN_STEM, label: 'Eights from seven-letter stems' }
		]
	},
	{ kind: 'wordSet', type: 'inWordList', label: 'In word list', negatable: true },
	{ kind: 'wordSet', type: 'inLexicon', label: 'In lexicon', negatable: true },
	{ kind: 'range', type: 'length', label: 'Length', minBound: 1, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'numVowels', label: 'Number of vowels', minBound: 0, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'numUniqueLetters', label: 'Unique letters', minBound: 1, maxBound: MAX_WORD_LENGTH },
	{ kind: 'range', type: 'pointValue', label: 'Point value', minBound: 0, maxBound: 100 },
	{ kind: 'range', type: 'numAnagrams', label: 'Number of anagrams', minBound: 1, maxBound: 20 },
	{
		kind: 'range',
		type: 'probability',
		label: 'Ways to draw',
		minBound: 0,
		maxBound: 1_000_000_000,
		blankAware: true
	},
	{
		kind: 'range',
		type: 'probabilityOrder',
		label: 'Probability rank',
		minBound: 1,
		maxBound: 100_000,
		blankAware: true
	},
	{ kind: 'range', type: 'playabilityOrder', label: 'Playability rank', minBound: 1, maxBound: 100_000 }
];

/** The condition groups, partitioned once for the builder's grouped picker. */
export const STRING_CONDITIONS = CONDITION_TYPES.filter(
	(c): c is StringMeta => c.kind === 'string'
);
export const RANGE_CONDITIONS = CONDITION_TYPES.filter((c): c is RangeMeta => c.kind === 'range');
export const CHOICE_CONDITIONS = CONDITION_TYPES.filter((c): c is ChoiceMeta => c.kind === 'choice');
export const WORD_SET_CONDITIONS = CONDITION_TYPES.filter(
	(c): c is WordSetMeta => c.kind === 'wordSet'
);

const META_BY_TYPE = new Map(CONDITION_TYPES.map((meta) => [meta.type, meta]));

export function metaFor(type: RangeField | StringField | WordSetField): ConditionMeta {
	const meta = META_BY_TYPE.get(type);
	if (!meta) throw new Error(`Unknown condition type: ${type}`);
	return meta;
}

/** A fresh condition with sensible defaults for the given metadata. */
export function defaultCondition(meta: ConditionMeta): SearchCondition {
	if (meta.kind === 'range') {
		return {
			kind: 'range',
			type: meta.type,
			min: meta.minBound,
			max: meta.maxBound,
			blanks: meta.blankAware ? 0 : undefined
		};
	}
	if (meta.kind === 'choice') {
		return { kind: 'string', type: meta.type, value: meta.options[0].value, negated: false };
	}
	if (meta.kind === 'wordSet') {
		return { kind: 'wordSet', type: meta.type, negated: false, label: '', words: [] };
	}
	return { kind: 'string', type: meta.type, value: '', negated: false };
}
