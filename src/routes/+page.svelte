<script lang="ts">
	import { fly } from 'svelte/transition';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { judgePlay, type Verdict } from '$lib/judge/judge';
	import JudgeMode from '$lib/judge/JudgeMode.svelte';
	import Tile from '$lib/components/Tile.svelte';

	let judgeMode = $state(false);
	let input = $state('');
	let ruling = $state<Verdict | null>(null);
	let inputEl = $state<HTMLTextAreaElement | null>(null);

	// Optional exit password for full-screen Word Judge (set before entering).
	let requirePassword = $state(false);
	let pass1 = $state('');
	let pass2 = $state('');
	const passwordMismatch = $derived(requirePassword && pass1 !== pass2);
	const judgePassword = $derived(requirePassword ? pass1 : '');

	const engine = $derived(lexicon.engine);
	const canLaunch = $derived(
		!!engine && (!requirePassword || (pass1.length > 0 && !passwordMismatch))
	);

	function launchJudge() {
		if (canLaunch) judgeMode = true;
	}
	const reduce =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function rule() {
		if (engine) ruling = judgePlay(engine, input);
	}

	function reset() {
		input = '';
		ruling = null;
		inputEl?.focus();
	}

	// Tab rules the play (matching Zyzzyva); Enter starts the next word on a new
	// line. Spaces are banned — words are newline-separated.
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab' && !event.shiftKey) {
			event.preventDefault();
			rule();
		} else if (event.key === ' ') {
			event.preventDefault();
		} else if (event.key === 'Escape') {
			reset();
		}
	}

	function onInput() {
		ruling = null;
		if (input.includes(' ')) input = input.replace(/ +/g, '\n'); // pasted spaces -> line breaks
	}

	$effect(() => {
		if (engine) inputEl?.focus();
	});
</script>

<section class="page judge">
	<header class="head">
		<span class="eyebrow">Judge</span>
		<h1>Is the play acceptable?</h1>
		<p class="muted">Type every word your play forms, one per line. You get one ruling for the whole play.</p>
	</header>

	<div class="entry">
		<textarea
			bind:this={inputEl}
			bind:value={input}
			onkeydown={onKeydown}
			oninput={onInput}
			rows="3"
			class="input input--word field"
			spellcheck="false"
			autocapitalize="characters"
			autocomplete="off"
			placeholder={engine ? 'Enter words here:' : 'loading lexicon…'}
			disabled={!engine}
			aria-label="Words your play forms, one per line"
		></textarea>
		<div class="entry-foot">
			<span class="faint">One word per line — <kbd class="kbd">Enter</kbd> for the next</span>
			<span class="enter"><kbd class="kbd">Tab</kbd> to rule</span>
		</div>
	</div>

	{#if ruling}
		<div
			class="verdict"
			class:ok={ruling.acceptable}
			role="status"
			in:fly={{ y: reduce ? 0 : 8, duration: reduce ? 0 : 200 }}
		>
			<Tile glyph={ruling.acceptable ? '✓' : '✕'} tone={ruling.acceptable ? 'valid' : 'invalid'} size="4.5rem" />
			<div class="ruling">
				<span class="eyebrow">the play is</span>
				<strong>{ruling.acceptable ? 'ACCEPTABLE' : 'UNACCEPTABLE'}</strong>
				<span class="words">{ruling.words.join(' · ')}</span>
			</div>
		</div>
	{/if}

	<div class="launch-block">
		<label class="opt">
			<input type="checkbox" bind:checked={requirePassword} disabled={!engine} />
			Require a password to exit
		</label>
		{#if requirePassword}
			<div class="passfields">
				<input
					type="password"
					class="passfield"
					bind:value={pass1}
					placeholder="Password"
					autocomplete="new-password"
					aria-label="Exit password"
				/>
				<input
					type="password"
					class="passfield"
					bind:value={pass2}
					placeholder="Confirm password"
					autocomplete="new-password"
					aria-label="Confirm exit password"
				/>
			</div>
			{#if passwordMismatch}<span class="warn">Passwords must match.</span>{/if}
		{/if}
		<button class="btn btn--ghost launch" onclick={launchJudge} disabled={!canLaunch}>
			Enter fullscreen Word Judge
		</button>
	</div>
</section>

{#if judgeMode && engine}
	<JudgeMode {engine} lexicon={lexicon.name} password={judgePassword} onExit={() => (judgeMode = false)} />
{/if}

<style>
	.judge {
		max-width: 42rem;
	}

	.head {
		margin-bottom: var(--s5);
	}
	.head h1 {
		margin: var(--s2) 0 var(--s2);
		font-size: clamp(1.6rem, 4vw, 2.2rem);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.head p {
		margin: 0;
		max-width: 32rem;
	}

	.field {
		font-size: clamp(1.4rem, 5vw, 2rem);
		line-height: 1.2;
		resize: none;
		padding: var(--s4);
	}
	/* Typed words stay uppercase; the prompt reads in normal case. */
	.field::placeholder {
		text-transform: none;
		letter-spacing: normal;
		font-family: var(--font-ui);
	}

	.entry-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: var(--s2);
		font-size: 0.85rem;
	}
	.enter {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--ink-dim);
	}

	.verdict {
		display: flex;
		align-items: center;
		gap: var(--s5);
		margin-top: var(--s6);
		padding: var(--s5);
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-left: 3px solid var(--invalid);
		border-radius: var(--r);
	}
	.verdict.ok {
		border-left-color: var(--valid);
	}
	.ruling {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.ruling strong {
		font-size: clamp(1.5rem, 5vw, 2.1rem);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--invalid);
	}
	.verdict.ok .ruling strong {
		color: var(--valid);
	}
	.words {
		font-family: var(--font-word);
		color: var(--ink-dim);
		letter-spacing: 0.06em;
		word-break: break-word;
	}

	.launch-block {
		margin-top: var(--s6);
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.launch {
		width: 100%;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--s2);
		color: var(--ink-dim);
		font-size: 0.9rem;
	}
	.passfields {
		display: flex;
		gap: var(--s3);
		flex-wrap: wrap;
	}
	.passfield {
		flex: 1;
		min-width: 10rem;
		background: var(--surface-1);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: var(--s3) var(--s4);
		font-size: 1rem;
	}
	.passfield:focus {
		outline: none;
		border-color: var(--accent);
	}
	.warn {
		color: var(--invalid);
		font-size: 0.85rem;
	}
</style>
