<script lang="ts">
	import type { WordEntry } from '$lib/lexicon';

	interface Props {
		entry: WordEntry;
	}
	let { entry }: Props = $props();

	const probRank = $derived(entry.probabilityOrder?.[0] ?? null);
</script>

<article class="card">
	<div class="headline">
		<span class="fronthooks" aria-label="front hooks">{entry.frontHooks.toLowerCase()}</span>
		<span class="word" class:fronthooked={entry.isFrontHook} class:backhooked={entry.isBackHook}>
			{entry.word}
		</span>
		<span class="backhooks" aria-label="back hooks">{entry.backHooks.toLowerCase()}</span>
	</div>

	{#if entry.definition}
		<p class="definition">{entry.definition}</p>
	{/if}

	<dl class="meta">
		<div><dt>len</dt><dd>{entry.length}</dd></div>
		<div><dt>pts</dt><dd>{entry.pointValue}</dd></div>
		{#if probRank != null}
			<div><dt>prob</dt><dd>#{probRank}</dd></div>
		{/if}
	</dl>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.85rem 1rem;
	}

	.headline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-word);
	}

	.word {
		font-size: 1.5rem;
		letter-spacing: 0.08em;
		font-weight: 600;
	}

	/* The word extends another word — flag the hookable side. */
	.word.fronthooked {
		border-left: 2px solid var(--accent);
		padding-left: 0.3rem;
	}
	.word.backhooked {
		border-right: 2px solid var(--accent);
		padding-right: 0.3rem;
	}

	.fronthooks,
	.backhooks {
		color: var(--accent);
		font-size: 1rem;
		letter-spacing: 0.06em;
		min-width: 1ch;
	}
	.fronthooks {
		text-align: right;
		flex: 1;
	}
	.backhooks {
		text-align: left;
		flex: 1;
	}

	.definition {
		margin: 0.6rem 0 0;
		color: var(--text);
		font-size: 0.95rem;
		line-height: 1.4;
	}

	.meta {
		display: flex;
		gap: 1.25rem;
		margin: 0.6rem 0 0;
		margin-top: auto;
		padding-top: 0.6rem;
		color: var(--muted);
		font-size: 0.8rem;
		font-family: var(--font-word);
	}
	.meta div {
		display: flex;
		gap: 0.35rem;
	}
	.meta dt,
	.meta dd {
		margin: 0;
	}
	.meta dt {
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.7;
	}
	.meta dd {
		color: var(--text);
	}
</style>
