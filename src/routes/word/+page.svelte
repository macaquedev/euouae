<script lang="ts">
	import { page } from '$app/state';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { letters } from '$lib/text';
	import WordCard from '$lib/components/WordCard.svelte';

	let query = $state(page.url.searchParams.get('q') ?? '');
	let inputEl = $state<HTMLInputElement | null>(null);

	// Deep links (?q=WORD — e.g. a word clicked in search results) prefill the
	// box, including when the page is already mounted and only the query changes.
	$effect(() => {
		const q = page.url.searchParams.get('q');
		if (q) query = q;
	});

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

<section class="word-info page">
	<header class="head">
		<span class="eyebrow">Word Info</span>
		<h1>Look up a word</h1>
		<p class="muted">Hooks, anagrams, definition and probability — updated as you type.</p>
	</header>

	<input
		bind:this={inputEl}
		bind:value={query}
		onkeydown={(e) => e.key === 'Escape' && (query = '')}
		spellcheck="false"
		autocapitalize="characters"
		autocomplete="off"
		placeholder={lexicon.engine ? 'EUOUAE' : 'loading lexicon…'}
		disabled={!lexicon.engine}
		aria-label="Word to look up"
	/>

	{#if normalized}
		{#if entry}
			<div class="main">
				<WordCard {entry} />
			</div>

			{#if anagrams.length}
				<div class="anagrams">
					<h3>Anagrams ({anagrams.length})</h3>
					<ul>
						{#each anagrams as w (w)}
							<li>
								{#if w === entry.word}
									<span class="self">{w}</span>
								{:else}
									<button class="ana" onclick={() => (query = w)}>{w}</button>
								{/if}
							</li>
						{/each}
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
	}

	.head {
		margin-bottom: var(--s5);
	}
	.head h1 {
		margin: var(--s2) 0;
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.head p {
		margin: 0;
		max-width: 34rem;
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
	.ana {
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		padding: 0;
	}
	.ana:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.self {
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
