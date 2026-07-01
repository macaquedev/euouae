<script lang="ts">
	import type { WordEntry } from '$lib/lexicon';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { joinHooks } from '$lib/text';

	interface Props {
		entry: WordEntry;
	}
	let { entry }: Props = $props();

	const rank = $derived(entry.probabilityOrder?.[0] ?? null);
	const playRank = $derived(entry.playabilityOrder ?? null);
	const multiChar = $derived(lexicon.engine?.alphabet.hasMultiCharTiles ?? false);
</script>

<!-- Columns come from --cols on an ancestor, shared with the table header so the
     word always starts at the same x. Hook columns are sized to the widest hooks
     in the result set, so hooks are shown in full (never truncated). -->
<div class="row">
	<span class="hooks front">{joinHooks(entry.frontHooks, multiChar).toLowerCase()}</span>
	<span class="word">{entry.word}</span>
	<span class="hooks back">{joinHooks(entry.backHooks, multiChar).toLowerCase()}</span>
	<span class="def">{entry.definition}</span>
	<span class="num">{entry.length}</span>
	<span class="num">{entry.pointValue}</span>
	<span class="num">{rank ?? ''}</span>
	<span class="num">{playRank ?? ''}</span>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: var(--cols);
		align-items: baseline;
		column-gap: 0.5rem;
		height: 100%;
		padding: 0 0.85rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.word {
		font-family: var(--font-word);
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.hooks {
		font-family: var(--font-word);
		color: var(--accent);
		font-size: 0.8rem;
		/* Unlike the rest of the row, hooks wrap: the column is capped (see
		   MAX_HOOK_COL in +page.svelte), so a word with a large hook set grows the
		   row taller instead of pushing the table wider. `anywhere` lets a run with
		   no natural break points (a tight, unspaced glyph string) still wrap, and
		   keeps the grid track from being forced back open to the unwrapped width. */
		white-space: normal;
		overflow-wrap: anywhere;
		/* Literal px, not a relative multiplier: +page.svelte's HOOK_LINE_HEIGHT
		   computes row height per-row from this exact number, so they must match. */
		line-height: 17px;
		min-width: 0;
	}
	.hooks.front {
		text-align: right;
	}

	.def {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.num {
		text-align: right;
		font-family: var(--font-word);
		font-size: 0.82rem;
		color: var(--muted);
	}
</style>
