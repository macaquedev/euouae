<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { ListStore } from '$lib/userdata/lists';
	import { getScratch } from '$lib/marinate/scratch';
	import { alphagram } from '$lib/lexicon/letters';

	// Marinate is a self-test cram sheet over a saved list. One input at the top
	// receives every answer; as soon as a typed token matches a row's answer, that
	// row fills in (turning green) and the token is consumed from the box. Two
	// recall modes, both using pure lexicon facts only (never definitions):
	//   words — alphagram → the list word that makes it (type the word)
	//   hooks — word → its hooks, typed as "front word back" (e.g. RH OARIEST),
	//           letters in any order; just the word alone when it has no hooks
	type Mode = 'words' | 'hooks';

	interface WordRow {
		readonly key: string;
		readonly alphagram: string;
		readonly word: string;
	}
	interface HookRow {
		readonly key: string;
		readonly word: string;
		readonly front: string;
		readonly back: string;
		// Decoy text shown (blurred) when answers are hidden. Always has the same
		// front·back shape regardless of real hooks, so the layout can't betray
		// which words actually take hooks.
		readonly mask: string;
	}

	let store = $state<ListStore | null>(null);
	let listName = $state<string | null>(null);
	let mode = $state<Mode>('words');
	let hideAnswers = $state(false);

	let wordRows = $state<WordRow[]>([]);
	let hookRows = $state<HookRow[]>([]);
	let skipped = $state(0);

	// Recall progress, keyed by word: words named in `words` mode, words whose full
	// hook answer has been given in `hooks` mode.
	let entry = $state('');
	let solvedWords = $state<Set<string>>(new Set());
	let solvedHooks = $state<Set<string>>(new Set());

	// Two ways in: a saved list (?list=<id>, loaded from the store) or an ad-hoc
	// set handed over from a search (no list id, words held in the scratch source).
	const listParam = $derived(page.url.searchParams.get('list'));
	const fromScratch = $derived(listParam === null);
	const backHref = $derived(fromScratch ? `${base}/search` : `${base}/lists`);
	const backLabel = $derived(fromScratch ? '← Search' : '← Lists');
	const ready = $derived(store !== null && lexicon.engine !== null);

	// Words grouped by alphagram in saved order, with fully-solved (exhausted)
	// groups sunk to the bottom so the words still to find stay up top.
	const displayRows = $derived.by(() => {
		const groups = new Map<string, WordRow[]>();
		for (const r of wordRows) {
			const g = groups.get(r.alphagram);
			if (g) g.push(r);
			else groups.set(r.alphagram, [r]);
		}
		const all = [...groups.values()];
		const exhausted = (g: WordRow[]) => g.every((r) => solvedWords.has(r.word));
		return [...all.filter((g) => !exhausted(g)), ...all.filter(exhausted)].flat();
	});

	// Hook rows in saved order with solved ones sunk to the bottom.
	const displayHookRows = $derived([
		...hookRows.filter((r) => !solvedHooks.has(r.word)),
		...hookRows.filter((r) => solvedHooks.has(r.word))
	]);

	const rowCount = $derived(mode === 'words' ? wordRows.length : hookRows.length);
	const solvedCount = $derived(
		mode === 'words'
			? wordRows.filter((r) => solvedWords.has(r.word)).length
			: hookRows.filter((r) => solvedHooks.has(r.word)).length
	);

	onMount(async () => {
		store = await ListStore.open();
	});

	// Build the rows for the current list and reset all recall progress. Words
	// absent from the active lexicon can't be quizzed, so they're counted skipped.
	$effect(() => {
		const engine = lexicon.engine;
		if (!engine) return;

		let words: string[];
		if (listParam !== null) {
			const id = Number(listParam);
			if (!store || !Number.isFinite(id)) return;
			listName = store.name(id) ?? null;
			words = listName === null ? [] : store.orderedWords(id);
		} else {
			const scratch = getScratch();
			listName = scratch?.name ?? null;
			words = scratch ? [...scratch.words] : [];
		}
		let absent = 0;

		const recall: WordRow[] = [];
		const hooks: HookRow[] = [];
		for (const word of words) {
			const hooked = engine.lookup(word);
			if (!hooked) {
				absent++;
				continue;
			}
			recall.push({ key: word, alphagram: alphagram(word), word });
			hooks.push({
				key: word,
				word,
				front: hooked.frontHooks,
				back: hooked.backHooks,
				mask: hookMask()
			});
		}
		wordRows = recall;
		hookRows = hooks;
		skipped = absent;
		reset();
	});

	function reset() {
		entry = '';
		solvedWords = new Set();
		solvedHooks = new Set();
	}

	// When the whole sheet is solved, give a brief green flash across the rows,
	// then wipe progress so you can run it again from scratch. `didCelebrate`
	// guards the one-shot so re-solving after the reset doesn't loop.
	let celebrating = $state(false);
	let didCelebrate = false;

	$effect(() => {
		const complete = rowCount > 0 && solvedCount === rowCount;
		if (complete && !didCelebrate) {
			didCelebrate = true;
			celebrating = true;
			setTimeout(() => {
				celebrating = false;
				reset();
				didCelebrate = false;
			}, 900);
		} else if (!complete) {
			didCelebrate = false;
		}
	});

	// A random "front · back" string used as blurred filler when answers are hidden.
	function hookMask(): string {
		const run = () =>
			Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () =>
				String.fromCharCode(97 + Math.floor(Math.random() * 26))
			).join('');
		return `${run()} · ${run()}`;
	}

	function sameLetters(a: string, b: string): boolean {
		return a.length === b.length && [...a].sort().join('') === [...b].sort().join('');
	}

	// Read a hooks answer "front word back" — find the token that is a row's word,
	// taking everything before it as front letters and after it as back letters.
	function interpretHooks(tokens: string[]): { row: HookRow; front: string; back: string } | null {
		for (let i = 0; i < tokens.length; i++) {
			const row = hookRows.find((r) => r.word === tokens[i]);
			if (row) return { row, front: tokens.slice(0, i).join(''), back: tokens.slice(i + 1).join('') };
		}
		return null;
	}

	// Attribute one typed word token to a row in `words` mode. `miss` = not an
	// answer (keep it in the box); `new` = freshly solved; `dup` = already had it.
	type Hit = { status: 'miss' | 'new' | 'dup'; key?: string };

	function consume(token: string): Hit {
		if (!wordRows.some((r) => r.word === token)) return { status: 'miss' };
		if (solvedWords.has(token)) return { status: 'dup', key: token };
		solvedWords = new Set(solvedWords).add(token);
		return { status: 'new' };
	}

	// Brief orange flash on the input and a table row when a duplicate is typed.
	let inputFlash = $state(false);
	let flashed = $state<Set<string>>(new Set());

	function flash(key: string) {
		inputFlash = false;
		flashed = new Set(flashed);
		flashed.delete(key);
		// Let the class drop for a tick so the CSS animation restarts cleanly.
		requestAnimationFrame(() => {
			inputFlash = true;
			flashed = new Set(flashed).add(key);
		});
		setTimeout(() => {
			inputFlash = false;
			const next = new Set(flashed);
			next.delete(key);
			flashed = next;
		}, 600);
	}

	const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

	function onInput() {
		if (mode === 'hooks') onHookInput();
		else onWordInput();
	}

	// Words live-match — no Enter needed. A complete match is consumed at once,
	// unless it's still a prefix of another unsolved word (e.g. CARE vs CARES), in
	// which case it waits for a separating space.
	function onWordInput() {
		const trailing = /\s$/.test(entry);
		const parts = entry.split(/\s+/).filter(Boolean);
		const targets = wordRows.filter((r) => !solvedWords.has(r.word)).map((r) => r.word);
		const leftover: string[] = [];
		parts.forEach((part, i) => {
			const token = normalize(part);
			const isPartial = i === parts.length - 1 && !trailing;
			if (isPartial && targets.some((t) => t !== token && t.startsWith(token))) {
				leftover.push(part);
				return;
			}
			const hit = consume(token);
			if (hit.status === 'miss') leftover.push(part);
			else if (hit.status === 'dup') flash(hit.key!);
		});
		entry = leftover.join(' ') + (trailing && leftover.length ? ' ' : '');
	}

	// Hooks live-match: the whole box is one "front word back" answer. It clears
	// only once the word is present and its front/back letter sets both match —
	// an incomplete or wrong answer just stays so you can keep typing or fix it.
	function onHookInput() {
		const tokens = entry
			.toUpperCase()
			.split(/\s+/)
			.map((t) => t.replace(/[^A-Z]/g, ''))
			.filter(Boolean);
		const interp = interpretHooks(tokens);
		if (!interp) return;
		const { row, front, back } = interp;
		if (!sameLetters(front, row.front) || !sameLetters(back, row.back)) return;
		if (solvedHooks.has(row.word)) flash(row.word);
		else solvedHooks = new Set(solvedHooks).add(row.word);
		entry = '';
	}

	function hidden(shown: boolean): boolean {
		return hideAnswers && !shown;
	}
</script>

<section class="marinate">
	<div class="head">
		<a class="back" href={backHref}>{backLabel}</a>
		<div class="title">
			<h2>{listName ?? 'Marinate'}</h2>
			<span class="meta">
				{solvedCount}/{rowCount}
				{#if skipped > 0}· {skipped} skipped{/if}
			</span>
		</div>
	</div>

	<div class="controls">
		<div class="modes">
			<button class="mode" class:on={mode === 'words'} onclick={() => (mode = 'words')}>Words</button>
			<button class="mode" class:on={mode === 'hooks'} onclick={() => (mode = 'hooks')}>Hooks</button>
		</div>
		<label class="hide">
			<input type="checkbox" bind:checked={hideAnswers} />
			Hide answers
		</label>
		<button class="reset" onclick={reset}>Reset</button>
	</div>

	{#if !ready}
		<p class="muted">Loading…</p>
	{:else if listName === null}
		{#if fromScratch}
			<p class="muted">
				No search results to marinate. <a class="link" href="{base}/search">Run a search</a> and choose
				Marinate.
			</p>
		{:else}
			<p class="muted">That list could not be found.</p>
		{/if}
	{:else if rowCount === 0}
		<p class="muted">No words in this list are valid in {lexicon.name}.</p>
	{:else}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="recall"
			class:flash={inputFlash}
			bind:value={entry}
			oninput={onInput}
			spellcheck="false"
			autocapitalize="characters"
			autocomplete="off"
			autofocus
			placeholder={mode === 'words' ? 'type the words…' : 'front word back, e.g. RH OARIEST…'}
		/>
		{#if mode === 'hooks'}
			<p class="formhint">
				Type <b>front word back</b> (letters in any order), e.g. <code>RH OARIEST</code>. Just the
				word if it has no hooks.
			</p>
		{/if}

		<div class="grid">
			<div class="rowhead">
				<span>{mode === 'words' ? 'Alphagram' : 'Word'}</span>
				<span>Answer</span>
			</div>
			{#if mode === 'words'}
				{#each displayRows as row, i (row.key)}
					{@const solved = solvedWords.has(row.word)}
					{@const repeat = i > 0 && displayRows[i - 1].alphagram === row.alphagram}
					<div
						class="row"
						class:solved
						class:flash={flashed.has(row.key)}
						class:celebrate={celebrating}
						animate:flip={{ duration: 250 }}
					>
						<span class="q">{repeat ? '' : row.alphagram}</span>
						<span class="answer" class:hidden={hidden(solved)} class:filled={solved}>{row.word}</span>
					</div>
				{/each}
			{:else}
				{#each displayHookRows as row (row.key)}
					{@const solved = solvedHooks.has(row.word)}
					<div
						class="row"
						class:solved
						class:flash={flashed.has(row.key)}
						class:celebrate={celebrating}
						animate:flip={{ duration: 250 }}
					>
						<span class="q">{row.word}</span>
						<span class="answer hooks" class:hidden={hidden(solved)} class:filled={solved}>
							{#if hidden(solved)}
								<span class="mask">{row.mask}</span>
							{:else if !row.front && !row.back}
								<span class="none">no hooks</span>
							{:else}
								<span class="hk">{row.front.toLowerCase() || '–'}</span>
								<span class="dot">·</span>
								<span class="hk">{row.back.toLowerCase() || '–'}</span>
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</section>

<style>
	.marinate {
		max-width: 50rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.back {
		color: var(--muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.back:hover {
		color: var(--text);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.title h2 {
		font-size: 1.1rem;
		margin: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.85rem;
		font-family: var(--font-word);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.modes {
		display: flex;
		gap: 0.35rem;
	}
	.mode {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		color: var(--muted);
		padding: 0.35rem 0.85rem;
		font-size: 0.9rem;
	}
	.mode:hover {
		color: var(--text);
		border-color: var(--accent);
	}
	.mode.on {
		color: var(--text);
		border-color: var(--accent);
		background: var(--surface-2);
	}
	.hide {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted);
		font-size: 0.9rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.reset {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		color: var(--muted);
		padding: 0.35rem 0.7rem;
		font-size: 0.85rem;
	}
	.reset:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	input.recall {
		width: 100%;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.8rem 1rem;
		font-family: var(--font-word);
		font-size: 1.2rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		outline: none;
		margin-bottom: 1rem;
	}
	input.recall:focus {
		border-color: var(--accent);
	}
	input.recall.flash {
		animation: flash-box 0.6s ease-out;
	}
	@keyframes flash-box {
		0% {
			border-color: var(--maple);
			background: color-mix(in srgb, var(--maple) 22%, var(--surface));
		}
		100% {
			border-color: var(--border);
			background: var(--surface);
		}
	}

	.grid {
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		overflow: hidden;
	}
	.rowhead,
	.row {
		display: grid;
		grid-template-columns: 12rem 1fr;
		gap: 1rem;
		align-items: center;
		padding: 0.5rem 0.9rem;
	}
	.rowhead {
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.row {
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
	.row.solved {
		background: color-mix(in srgb, var(--valid) 12%, var(--surface));
	}
	.row.flash {
		animation: flash-row 0.6s ease-out;
	}
	@keyframes flash-row {
		0% {
			background: color-mix(in srgb, var(--maple) 30%, var(--surface));
		}
		100% {
			background: var(--surface);
		}
	}
	.row.celebrate {
		animation: flash-green 0.9s ease-out;
	}
	@keyframes flash-green {
		0%,
		35% {
			background: color-mix(in srgb, var(--valid) 40%, var(--surface));
		}
		100% {
			background: var(--surface);
		}
	}

	.q {
		font-family: var(--font-word);
		font-weight: 600;
		font-size: 1.1rem;
		letter-spacing: 0.1em;
	}

	.answer {
		min-width: 0;
		font-family: var(--font-word);
		letter-spacing: 0.05em;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.answer.filled {
		color: var(--valid);
	}
	.hooks {
		display: flex;
		align-items: baseline;
	}
	.hk {
		color: var(--accent);
	}
	.answer.filled .hk {
		color: var(--valid);
	}
	.dot {
		color: var(--muted);
		margin: 0 0.4rem;
	}
	.none {
		color: var(--muted);
	}
	.mask {
		color: var(--text);
	}

	/* Hidden answers blur in place; a solved/found token un-blurs as it fills. */
	.hidden {
		filter: blur(7px);
		user-select: none;
	}

	.muted {
		color: var(--muted);
	}
	.muted .link {
		color: var(--accent);
		text-decoration: none;
	}
	.muted .link:hover {
		text-decoration: underline;
	}

	.formhint {
		margin: -0.5rem 0 1rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.formhint code {
		font-family: var(--font-word);
		color: var(--text);
		letter-spacing: 0.05em;
	}
</style>
