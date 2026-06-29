<script lang="ts">
	import type { WordEntry } from '$lib/lexicon';

	interface Props {
		entry: WordEntry;
	}
	let { entry }: Props = $props();

	const rank = $derived(entry.probabilityOrder?.[0] ?? null);
</script>

<!-- Columns come from --cols on an ancestor, shared with the table header so the
     word always starts at the same x. Hook columns are sized to the widest hooks
     in the result set, so hooks are shown in full (never truncated). -->
<div class="row">
	<span class="hooks front">{entry.frontHooks.toLowerCase()}</span>
	<span class="word">{entry.word}</span>
	<span class="hooks back">{entry.backHooks.toLowerCase()}</span>
	<span class="def">{entry.definition}</span>
	<span class="num">{entry.length}</span>
	<span class="num">{entry.pointValue}</span>
	<span class="num">{rank ?? ''}</span>
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
