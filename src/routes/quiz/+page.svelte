<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setScratch } from '$lib/marinate/scratch';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { LeitnerScheduler, FsrsScheduler } from '$lib/scheduler';
	import { CardStore } from '$lib/quiz/cards';
	import { listDeck, type Deck } from '$lib/quiz/decks';
	import { ListStore } from '$lib/userdata/lists';
	import { QuizSession, type QuizMethod, type QuizOrder } from '$lib/quiz/session.svelte';
	import { quiz } from '$lib/quiz/store';
	import { plural } from '$lib/text';
	import WordCard from '$lib/components/WordCard.svelte';
	import Tile from '$lib/components/Tile.svelte';

	let method = $state<QuizMethod>('fsrs');
	let order = $state<QuizOrder>('random');
	let session = $state<QuizSession | null>(null);
	let starting = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let listDecks = $state<Deck[]>([]);
	let listStore: ListStore | null = null;

	const deckGroups = $derived(
		listDecks.length ? [{ title: 'Saved lists', decks: listDecks }] : []
	);

	async function loadDecks(lex: string) {
		listStore ??= await ListStore.open();
		if (lex !== activeLex) return; // a newer switch already superseded this load
		listDecks = listStore
			.summaries(lex)
			.map((l) => listDeck(l.id, l.name, listStore!.words(l.id)));
	}

	// Decks belong to the active lexicon. Switching lexicons drops any in-progress
	// session (committing its pending grade) and reloads the new lexicon's decks, so
	// the study panel never shows a stale list from the lexicon we just left.
	let activeLex: string | null = null;
	$effect(() => {
		const lex = lexicon.name;
		untrack(() => {
			if (lex === activeLex) return;
			const first = activeLex === null;
			activeLex = lex;
			if (!first) quit();
			void loadDecks(lex).then(() => {
				if (!first) return;
				const wanted = page.url.searchParams.get('deck');
				// Returning to the quiz resumes an in-progress session — unless the URL
				// explicitly asks for a different deck (a fresh Study deep link wins).
				const live = quiz.live(lex);
				if (live && (!wanted || wanted === live.deckId)) return adopt(live.session);
				// Deep link from the Lists page: ?deck=<id> auto-starts that deck.
				if (wanted) {
					const deck = listDecks.find((d) => d.id === wanted);
					if (deck) start(deck);
				}
			});
		});
	});

	// Resume an in-progress session for `deck` if one is still live, so returning
	// to a deck picks up its running tally rather than restarting it.
	function adopt(existing: QuizSession) {
		session = existing;
		existing.resumeTimer();
		existing.markTimingUnreliable(); // the current question sat idle while away
		resetIdle();
	}

	// The deck most recently started, so the "nothing due" screen can offer to
	// drill it anyway without rescheduling anything.
	let lastDeck: Deck | null = null;

	async function start(deck: Deck) {
		const engine = lexicon.engine;
		if (!engine || starting) return;
		lastDeck = deck;
		const existing = quiz.resume(lexicon.name, deck.id);
		if (existing) return adopt(existing);
		starting = true;
		try {
			const questions = deck.resolve(engine);
			const store = await CardStore.open(lexicon.name, deck.id);
			const scheduler = method === 'fsrs' ? new FsrsScheduler() : new LeitnerScheduler();
			const built = new QuizSession(engine, store, scheduler, method, questions, order);
			quiz.begin(lexicon.name, deck.id, built);
			session = built;
			resetIdle();
		} finally {
			starting = false;
		}
	}

	function quit() {
		quiz.end();
		session = null;
		clearTimeout(idleTimer);
	}

	// From the "nothing due" screen: rerun the same deck as a Standard drill,
	// which quizzes everything and never touches the schedule.
	async function drillAnyway() {
		const deck = lastDeck;
		if (!deck) return;
		quit();
		method = 'standard';
		await start(deck);
	}

	// Open the words you missed in the shared Marinate sheet — a pure study aside
	// that changes no grade or schedule. The live quiz stays in the store, so
	// Marinate's Back link resumes it on the same question.
	function marinateMisses(missed: string[], name: string) {
		if (!missed.length) return;
		setScratch({ name, words: missed });
		goto(`${base}/marinate?from=quiz`);
	}

	// AFK handling for FSRS latency timing: pause the clock while the window is
	// hidden/blurred, and distrust the timing after a long idle (treated as Good).
	const IDLE_MS = 45_000;
	let idleTimer: ReturnType<typeof setTimeout>;

	function resetIdle() {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => session?.markTimingUnreliable(), IDLE_MS);
	}
	function onVisibility() {
		if (document.hidden) {
			session?.pauseTimer();
		} else {
			session?.resumeTimer();
			if (session) resetIdle();
		}
	}

	onMount(() => document.addEventListener('visibilitychange', onVisibility));
	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisibility);
		clearTimeout(idleTimer);
		// The session lives on in the store so navigating away and back resumes it;
		// just bank the away-time out of the current question's latency.
		session?.pauseTimer();
	});

	// Guards against key-repeat: advancing refocuses the input via a microtask,
	// which can land a second rapid Enter on the freshly-loaded card and
	// auto-reveal/mis-grade it before the user has typed anything.
	const ENTER_DEBOUNCE_MS = 80;
	let lastEnterAt = 0;

	function onKeydown(event: KeyboardEvent) {
		if (!session || session.done) return;
		resetIdle(); // typing is activity — push back the idle watchdog
		if (event.key === 'Enter') {
			// A focused button (Quit, Mark, Next…) handles its own Enter/click.
			if (document.activeElement instanceof HTMLButtonElement) return;
			const now = Date.now();
			if (now - lastEnterAt < ENTER_DEBOUNCE_MS) {
				event.preventDefault();
				return;
			}
			lastEnterAt = now;
			event.preventDefault();
			if (session.revealed) {
				session.advance();
				queueMicrotask(() => inputEl?.focus());
			} else if (session.guess.trim()) {
				const { duplicate, invalid } = session.submit();
				if (duplicate) flash(duplicate);
				else if (invalid && !session.revealed) flashInput();
			} else {
				session.reveal();
			}
		} else if ((event.key === 'm' || event.key === 'M') && session.revealed) {
			event.preventDefault();
			session.mark();
		}
	}

	// A re-typed found word flashes its row; a typo (not built from the rack)
	// flashes just the input box and is dropped without penalty.
	let inputFlash = $state(false);
	let flashed = $state<Set<string>>(new Set());

	function flashInput() {
		inputFlash = false;
		requestAnimationFrame(() => (inputFlash = true));
		setTimeout(() => (inputFlash = false), 600);
	}

	function flash(word: string) {
		flashInput();
		flashed = new Set(flashed);
		flashed.delete(word);
		requestAnimationFrame(() => {
			flashed = new Set(flashed).add(word);
		});
		setTimeout(() => {
			const next = new Set(flashed);
			next.delete(word);
			flashed = next;
		}, 600);
	}

	$effect(() => {
		if (session && !session.revealed) inputEl?.focus();
	});
</script>

<svelte:window
	onkeydown={onKeydown}
	onblur={() => session?.pauseTimer()}
	onfocus={() => {
		session?.resumeTimer();
		if (session) resetIdle();
	}}
/>

<section class="quiz page">
	{#if !session}
		<header class="head">
			<span class="eyebrow">Study</span>
			<h1>Drill anagrams</h1>
			<p class="muted">
				Pick a deck built from a saved list. FSRS and Cardbox space your reviews over
					time; Standard just drills.
			</p>
		</header>
		<div class="setup">
			<div class="controls">
				<label class="control">
					<span class="control-label">Method</span>
					<div class="select">
						<select bind:value={method}>
							<option value="fsrs">FSRS (timed, adaptive)</option>
							<option value="cardbox">Cardbox (Leitner)</option>
							<option value="standard">Standard (drill)</option>
						</select>
					</div>
				</label>
				<label class="control">
					<span class="control-label">Order</span>
					<div class="select">
						<select bind:value={order}>
							<option value="random">Random</option>
							<option value="alphabetical">Alphabetical</option>
							<option value="probability">Probability</option>
							<option value="playability">Playability</option>
							<option value="schedule">Schedule</option>
							<option value="schedule-zero-first">Schedule (box 0 first)</option>
						</select>
					</div>
				</label>
			</div>

			{#each deckGroups as group (group.title)}
				<h2 class="group-title eyebrow">{group.title}</h2>
				<div class="decks">
					{#each group.decks as deck (deck.id)}
						<button class="deck" disabled={!lexicon.engine || starting} onclick={() => start(deck)}>
							<span class="deck-id">
								<span class="deck-name">{deck.label}</span>
								<span class="deck-size">{plural(deck.size)}</span>
							</span>
							<span class="deck-go" aria-hidden="true">Study →</span>
						</button>
					{/each}
				</div>
			{/each}

			{#if !deckGroups.length}
				<div class="empty-decks panel">
					<p class="muted">
						No decks yet — save a list of words from <a href="{base}/search">Search</a> or
						<a href="{base}/lists">Lists</a> to study it here.
					</p>
				</div>
			{/if}

			{#if starting}<p class="muted building">Building deck…</p>{/if}
		</div>
	{:else if session.total === 0}
		<div class="empty panel">
			{#if session.scheduledCount > 0}
				<p>Nothing due right now — {plural(session.scheduledCount, 'card')} scheduled for later.</p>
				<div class="empty-actions">
					<button class="btn btn--ghost" onclick={quit}>← Back</button>
					<button class="btn btn--primary" onclick={drillAnyway}>
						Drill them anyway (no scheduling)
					</button>
				</div>
			{:else}
				<p>This deck has no questions.</p>
				<button class="btn btn--ghost" onclick={quit}>← Back</button>
			{/if}
		</div>
	{:else if session.done}
		{@const total = session.correctCount + session.incorrectCount}
		{@const pct = total > 0 ? Math.round((session.correctCount / total) * 100) : 0}
		<div class="summary panel">
			<span class="eyebrow">Session complete</span>
			<div class="score-ring" style:--pct="{pct}">
				<span class="score-pct">{pct}<small>%</small></span>
			</div>
			<p class="score">
				<span class="ok">{session.correctCount}</span> of {total} correct
			</p>
			<div class="summary-actions">
				{#if session.missedWords.size}
					<button
						class="btn btn--ghost"
						onclick={() => session && marinateMisses([...session.missedWords], 'Quiz misses')}
					>
						Marinate {session.missedWords.size} missed
					</button>
				{/if}
				<button class="btn btn--primary new-quiz" onclick={quit}>New quiz</button>
			</div>
		</div>
	{:else}
		{@const found = session.foundWords.size}
		{@const goal = session.answers.length}
		{@const progress = goal ? (found / goal) * 100 : 0}
		<div class="play">
			<div class="bar">
				<span class="pos">{session.index + 1}<span class="of">/ {session.total}</span></span>
				<span class="tally">
					<span class="ok">{session.correctCount}</span><span class="tally-sep">·</span><span class="bad">{session.incorrectCount}</span>
				</span>
				<button class="btn btn--ghost quit" onclick={quit}>Quit</button>
			</div>

			<!-- Tokenized through the active lexicon's alphabet, so point values match
			     its tile set (French K is 10, not English 5) and a multi-character
			     tile (Spanish CH) renders as one tile, never split into letters. -->
			<div class="rack">
				{#each lexicon.engine?.alphabet.tokenize(session.question) ?? [] as tile, i (i)}
					<Tile glyph={tile.glyph} value={tile.value} size="clamp(2.1rem, 8vw, 3.3rem)" />
				{/each}
			</div>

			<div class="progress" role="progressbar" aria-valuenow={found} aria-valuemax={goal}>
				<div class="progress-track">
					<div class="progress-fill" style:width="{progress}%"></div>
				</div>
				<span class="progress-label">{found} <span class="muted">/ {goal} found</span></span>
			</div>

			<input
				bind:this={inputEl}
				class="input input--word play-input"
				class:flash={inputFlash}
				bind:value={session.guess}
				disabled={session.revealed}
				spellcheck="false"
				autocapitalize="characters"
				autocomplete="off"
				placeholder="type a word and press Enter to play it"
			/>

			{#if session.revealed}
				<div class="verdict" class:good={session.graded === 'correct'} class:bad={session.graded === 'incorrect'}>
					{#if session.graded === 'correct'}
						<span class="verdict-dot"></span> All found
					{:else}
						<span class="verdict-dot"></span> Missed{session.missed.length ? ` ${session.missed.length} of ${session.answers.length}` : ''}
					{/if}
				</div>
				{#if session.missed.length}
					<div class="marinate-cta">
						<button
							class="btn btn--ghost"
							onclick={() => session && marinateMisses(session.missed.map((e) => e.word), session.question)}
						>
							Marinate {session.missed.length === 1 ? 'this miss' : 'these misses'}
						</button>
					</div>
				{/if}
			{/if}

			<div class="answers">
				{#each session.answers as entry, i (entry.word)}
					{@const isFound = session.foundWords.has(entry.word)}
					{@const credited = isFound || session.graded === 'correct'}
					{#if isFound || session.revealed}
						<div
							class="answer"
							class:found={credited}
							class:miss={session.revealed && !credited}
							class:flash={flashed.has(entry.word)}
						>
							<WordCard {entry} />
						</div>
					{:else}
						<div class="slot">
							<span class="slot-num">{i + 1}</span>
							<span class="slot-blank">{'·'.repeat(entry.word.length)}</span>
						</div>
					{/if}
				{/each}
			</div>

			{#if session.revealed}
				<div class="finish">
					<button class="btn btn--ghost mark" onclick={() => session?.mark()}>
						{session.graded === 'correct' ? 'Mark as missed' : 'Mark as correct'}
						<kbd class="kbd">M</kbd>
					</button>
					<button class="btn btn--primary next" onclick={() => session?.advance()}>Next →</button>
				</div>
			{:else}
				<button class="btn btn--ghost wide" onclick={() => session?.reveal()}>Reveal answers</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.quiz {
		max-width: 46rem;
	}

	.head {
		margin-bottom: var(--s6);
	}
	.head h1 {
		margin: var(--s2) 0 var(--s3);
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.head p {
		margin: 0;
		max-width: 34rem;
	}

	/* — Setup ———————————————————————————————————————————————————— */
	.controls {
		display: flex;
		gap: var(--s4);
		flex-wrap: wrap;
		margin-bottom: var(--s6);
	}
	.control {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		flex: 1;
		min-width: 13rem;
	}
	.control-label {
		font-family: var(--font-word);
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding-left: 0.1rem;
	}
	/* A select dressed as a design-system field, with our own chevron. */
	.select {
		position: relative;
	}
	.select::after {
		content: '';
		position: absolute;
		top: 50%;
		right: 0.9rem;
		width: 0.5rem;
		height: 0.5rem;
		border-right: 2px solid var(--ink-dim);
		border-bottom: 2px solid var(--ink-dim);
		transform: translateY(-65%) rotate(45deg);
		pointer-events: none;
	}
	.select select {
		appearance: none;
		width: 100%;
		background: var(--surface-2);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: 0.65rem 2.2rem 0.65rem 0.9rem;
		font: inherit;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
	}
	.select select:hover {
		border-color: var(--line-strong);
	}
	.select select:focus-visible {
		outline: none;
		border-color: var(--maple);
		box-shadow: 0 0 0 3px var(--maple-ghost);
	}

	.group-title {
		display: block;
		margin: 0 0 var(--s3);
	}

	.decks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: var(--s3);
	}
	.deck {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
		text-align: left;
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: 0.85rem 1rem;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--ink);
		transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease),
			transform var(--t-fast) var(--ease);
	}
	.deck-id {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.deck-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.deck-size {
		font-family: var(--font-word);
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--ink-faint);
	}
	.deck-go {
		font-family: var(--font-word);
		font-size: 0.8rem;
		color: var(--maple);
		opacity: 0;
		transform: translateX(-0.25rem);
		transition: opacity var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
	}
	.deck:hover:not(:disabled) {
		border-color: var(--maple);
		background: var(--surface-2);
	}
	.deck:hover:not(:disabled) .deck-go {
		opacity: 1;
		transform: translateX(0);
	}
	.deck:active:not(:disabled) {
		transform: translateY(1px);
	}
	.deck:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.empty-decks {
		margin-top: var(--s2);
	}
	.empty-decks p {
		margin: 0;
	}
	.empty-decks a {
		color: var(--maple);
		text-decoration: none;
	}
	.empty-decks a:hover {
		text-decoration: underline;
	}
	.building {
		margin-top: var(--s4);
	}

	/* — Play: header bar ————————————————————————————————————————— */
	.play {
		outline: none;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-family: var(--font-word);
		font-size: 0.9rem;
		margin-bottom: var(--s5);
	}
	.pos {
		color: var(--ink);
		font-weight: 500;
	}
	.pos .of {
		color: var(--ink-faint);
		margin-left: 0.35rem;
	}
	.tally {
		font-family: var(--font-word);
		font-weight: 600;
	}
	.tally-sep {
		color: var(--ink-faint);
		margin: 0 0.4rem;
	}
	.quit {
		padding: 0.3rem 0.7rem;
		font-size: 0.85rem;
	}

	/* — Play: rack ——————————————————————————————————————————————— */
	.rack {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: var(--s4);
	}

	/* — Play: progress —————————————————————————————————————————— */
	.progress {
		display: flex;
		align-items: center;
		gap: var(--s3);
		margin-bottom: var(--s4);
	}
	.progress-track {
		flex: 1;
		height: 6px;
		background: var(--surface-2);
		border-radius: var(--r-pill);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--maple-deep), var(--maple));
		border-radius: var(--r-pill);
		transition: width var(--t) var(--ease);
	}
	.progress-label {
		font-family: var(--font-word);
		font-size: 0.82rem;
		color: var(--ink);
		white-space: nowrap;
	}

	/* — Play: input ————————————————————————————————————————————— */
	.play-input {
		font-size: clamp(1.1rem, 4vw, 1.4rem);
		padding: 0.85rem 1rem;
	}
	.play-input::placeholder {
		text-transform: none;
		letter-spacing: normal;
		font-family: var(--font-ui);
		font-size: 0.95rem;
		color: var(--ink-faint);
	}
	.play-input:disabled {
		opacity: 0.6;
	}
	.play-input.flash {
		animation: flash-box 0.6s var(--ease);
	}
	@keyframes flash-box {
		0% {
			border-color: var(--maple);
			background: color-mix(in srgb, var(--maple) 22%, var(--surface-2));
		}
		100% {
			border-color: var(--line);
			background: var(--surface-2);
		}
	}

	/* — Play: verdict banner ———————————————————————————————————— */
	.verdict {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--s2);
		margin: var(--s4) 0 0;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.verdict-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 8px currentColor;
	}
	.verdict.good {
		color: var(--valid);
	}
	.verdict.bad {
		color: var(--invalid);
	}

	/* — Play: answers grid —————————————————————————————————————— */
	.answers {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: var(--s3);
		margin: var(--s4) 0 var(--s5);
	}
	.answer {
		display: flex;
		border-radius: var(--r);
		border-left: 3px solid transparent;
	}
	.answer :global(.card) {
		flex: 1;
	}
	.answer.found {
		border-left-color: var(--valid);
	}
	.answer.miss {
		border-left-color: var(--invalid);
	}
	.answer.flash {
		animation: flash-row 0.6s var(--ease);
	}
	@keyframes flash-row {
		0% {
			background: color-mix(in srgb, var(--maple) 30%, transparent);
		}
		100% {
			background: transparent;
		}
	}

	/* An answer not yet found: a slim numbered slot to be filled in. */
	.slot {
		display: flex;
		align-items: center;
		gap: var(--s3);
		background: var(--surface-1);
		border: 1px dashed var(--line);
		border-radius: var(--r);
		padding: 0.85rem 1rem;
		min-height: 3rem;
	}
	.slot-num {
		font-family: var(--font-word);
		font-size: 0.8rem;
		color: var(--ink-faint);
		min-width: 1.4ch;
		text-align: right;
	}
	.slot-blank {
		font-family: var(--font-word);
		font-size: 1.3rem;
		letter-spacing: 0.32em;
		color: var(--ink-faint);
		opacity: 0.5;
		user-select: none;
	}

	/* — Play / summary actions —————————————————————————————————— */
	.finish {
		display: flex;
		gap: var(--s3);
		align-items: stretch;
		margin-top: var(--s4);
	}
	.finish .next {
		flex: 1;
		font-weight: 600;
	}
	.mark {
		white-space: nowrap;
	}
	.wide {
		width: 100%;
		padding: 0.75rem;
		margin-top: var(--s4);
	}

	/* — Summary / empty ————————————————————————————————————————— */
	.summary,
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s4);
		text-align: center;
		padding: var(--s7) var(--s5);
	}
	.empty {
		gap: var(--s5);
	}
	.empty p {
		margin: 0;
	}
	.empty-actions {
		display: flex;
		gap: var(--s3);
		flex-wrap: wrap;
		justify-content: center;
	}
	.score {
		margin: 0;
		font-size: 1.1rem;
		color: var(--ink-dim);
	}
	.new-quiz {
		min-width: 12rem;
	}
	.summary-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s3);
	}
	.marinate-cta {
		display: flex;
		justify-content: center;
		margin-top: var(--s3);
	}

	/* A conic-gradient score ring — the session's headline number. */
	.score-ring {
		--size: 7.5rem;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: conic-gradient(
			var(--maple) calc(var(--pct) * 1%),
			var(--surface-3) 0
		);
	}
	.score-ring::before {
		content: '';
		grid-area: 1 / 1;
		width: calc(var(--size) - 1.1rem);
		height: calc(var(--size) - 1.1rem);
		border-radius: 50%;
		background: var(--surface-1);
	}
	.score-pct {
		grid-area: 1 / 1;
		font-family: var(--font-word);
		font-size: 1.9rem;
		font-weight: 600;
		color: var(--ink);
	}
	.score-pct small {
		font-size: 0.9rem;
		color: var(--ink-dim);
		margin-left: 0.1rem;
	}

	.ok {
		color: var(--valid);
	}
	.bad {
		color: var(--invalid);
	}

	@media (max-width: 480px) {
		.finish {
			flex-direction: column;
		}
	}
</style>
