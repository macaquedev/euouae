<script lang="ts">
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { letters } from '$lib/text';
	import WordCard from '$lib/components/WordCard.svelte';

	let query = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	const normalized = $derived(letters(query));

	// A pure, synchronous read off the lexicon, so it derives straight from the
	// input — no manual submit needed. Word Info is about this one word only.
	const entry = $derived(
		lexicon.engine && normalized ? lexicon.engine.lookup(normalized) : undefined
	);

	// Other words sharing this word's alphagram, shown as a compact list.
	const anagrams = $derived(
		entry && lexicon.engine ? lexicon.engine.anagrams(entry.alphagram).map((e) => e.word) : []
	);

	$effect(() => {
		inputEl?.focus();
	});
</script>

<section class="word-info">
	<label class="field">
		<span class="label">Word Info — type a word</span>
		<input
			bind:this={inputEl}
			bind:value={query}
			spellcheck="false"
			autocapitalize="characters"
			autocomplete="off"
			placeholder={lexicon.engine ? 'EUOUAE' : 'loading lexicon…'}
			disabled={!lexicon.engine}
		/>
	</label>

	{#if normalized}
		{#if entry}
			<div class="main">
				<WordCard {entry} />
			</div>

			{#if anagrams.length}
				<div class="anagrams">
					<h3>Anagrams ({anagrams.length})</h3>
					<ul>
						{#each anagrams as w (w)}<li class:self={w === entry.word}>{w}</li>{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<p class="not-found">
				<span class="bad">{normalized}</span> is not valid in {lexicon.name}.
			</p>
		{/if}
	{/if}
</section>

<style>
	.word-info {
		max-width: 46rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 4rem;
	}

	.field {
		display: block;
	}

	.label {
		display: block;
		color: var(--muted);
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	input {
		width: 100%;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.85rem 1rem;
		font-family: var(--font-word);
		font-size: 1.4rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		outline: none;
	}
	input:focus {
		border-color: var(--accent);
	}

	.main {
		margin-top: 1.75rem;
	}

	h3 {
		font-size: 0.85rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0 0 0.6rem;
		font-weight: 600;
	}

	.anagrams {
		margin-top: 1.5rem;
	}
	.anagrams ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.7rem;
	}
	.anagrams li {
		font-family: var(--font-word);
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.anagrams li.self {
		color: var(--text);
		font-weight: 600;
	}

	.not-found {
		margin-top: 1.75rem;
		color: var(--muted);
	}
	.bad {
		font-family: var(--font-word);
		color: var(--invalid);
		letter-spacing: 0.08em;
	}
</style>
