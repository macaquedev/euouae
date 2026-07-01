<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { LexiconEngine } from '$lib/lexicon';
	import { judgePlay, type Verdict } from '$lib/judge/judge';
	import { enterKiosk, exitKiosk } from '$lib/platform/kiosk';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import Tile from '$lib/components/Tile.svelte';

	interface Props {
		engine: LexiconEngine;
		lexicon: string;
		/** When set, this password must be entered to leave Word Judge. */
		password?: string;
		onExit: () => void;
	}

	let { engine, lexicon, password = '', onExit }: Props = $props();

	// Mirrors Zyzzyva's Word Judge timing.
	const CLEAR_RESULTS_DELAY = 10000;
	const CLEAR_RESULTS_MIN_DELAY = 500;
	const CLEAR_EXIT_DELAY = 10000; // the exit screen returns to judging after inactivity
	const CLEAR_INCORRECT_PASSWORD_DELAY = 1500;

	let input = $state('');
	let result = $state<Verdict | null>(null);
	// The exit screen: one Escape opens it; Enter (or the right password) leaves.
	let exiting = $state(false);
	let passwordInput = $state('');
	let passwordError = $state(false);
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let passwordEl = $state<HTMLInputElement | null>(null);
	let resultLocked = false; // brief hold so a keypress can't instantly clear

	let resultClearTimer: ReturnType<typeof setTimeout> | undefined;
	let resultLockTimer: ReturnType<typeof setTimeout> | undefined;
	let exitTimer: ReturnType<typeof setTimeout> | undefined;
	let passwordErrorTimer: ReturnType<typeof setTimeout> | undefined;

	function judge() {
		const ruling = judgePlay(engine, input);
		if (!ruling) return;
		result = ruling;
		input = '';

		resultLocked = true;
		clearTimeout(resultLockTimer);
		resultLockTimer = setTimeout(() => (resultLocked = false), CLEAR_RESULTS_MIN_DELAY);

		clearTimeout(resultClearTimer);
		resultClearTimer = setTimeout(clearResult, CLEAR_RESULTS_DELAY);
	}

	function clearResult() {
		result = null;
		clearTimeout(resultClearTimer);
		queueMicrotask(() => inputEl?.focus());
	}

	// One Escape brings up the exit screen, as in Zyzzyva (no 10× tapping).
	function beginExit() {
		exiting = true;
		passwordInput = '';
		passwordError = false;
		armExitTimeout();
		queueMicrotask(() => passwordEl?.focus());
	}

	function armExitTimeout() {
		clearTimeout(exitTimer);
		exitTimer = setTimeout(cancelExit, CLEAR_EXIT_DELAY);
	}

	function cancelExit() {
		exiting = false;
		passwordInput = '';
		passwordError = false;
		clearTimeout(exitTimer);
		clearTimeout(passwordErrorTimer);
		queueMicrotask(() => inputEl?.focus());
	}

	function tryExit() {
		if (!password || passwordInput === password) {
			onExit();
			return;
		}
		// Wrong password: flash a message, then drop back to judging — a stray
		// guess can't sit on the exit screen brute-forcing (matches Zyzzyva).
		passwordError = true;
		passwordInput = '';
		clearTimeout(exitTimer);
		clearTimeout(passwordErrorTimer);
		passwordErrorTimer = setTimeout(cancelExit, CLEAR_INCORRECT_PASSWORD_DELAY);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (exiting) {
			// On the exit screen Escape cancels; Enter leaves when no password is set
			// (with a password, the field's own handler validates on Enter).
			if (event.key === 'Escape') {
				event.preventDefault();
				cancelExit();
			} else if (!password && event.key === 'Enter') {
				event.preventDefault();
				tryExit();
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			beginExit();
			return;
		}
		// Lone modifier presses shouldn't dismiss a result (and type nothing anyway).
		if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
		// While a result is shown, a key only advances to the next play — swallow it
		// so the character is never typed into the (now empty) next play.
		if (result) {
			event.preventDefault();
			if (!resultLocked) clearResult();
		}
	}

	function onPasswordKeydown(event: KeyboardEvent) {
		armExitTimeout(); // any typing keeps the exit screen alive
		if (event.key === 'Enter') {
			event.preventDefault();
			tryExit();
		}
	}

	function onInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			event.preventDefault(); // Tab rules the play (matching Zyzzyva)
			judge();
		} else if (event.key === ' ') {
			event.preventDefault(); // words are newline-separated; spaces are banned
		}
		// Enter falls through to the default newline — it starts the next word.
	}

	function onInput() {
		if (input.includes(' ')) input = input.replace(/ +/g, '\n'); // pasted spaces -> line breaks
	}

	onMount(() => {
		// Native fullscreen+on-top under Tauri, browser fullscreen otherwise. The
		// overlay is the real lock, so judge mode holds even if fullscreen drops.
		enterKiosk();
		// Block global shortcuts (Ctrl+K, ?, g-then-key nav) so they can't open an
		// overlay or navigate out from under a password-locked session.
		kbd.lock();
		inputEl?.focus();
	});

	onDestroy(() => {
		exitKiosk();
		kbd.unlock();
		clearTimeout(resultClearTimer);
		clearTimeout(resultLockTimer);
		clearTimeout(exitTimer);
		clearTimeout(passwordErrorTimer);
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="kiosk" role="application">
	{#if exiting}
		<div class="exit-screen">
			{#if password}
				<p class="exit-instruction">Enter password to exit Word Judge.</p>
				<input
					bind:this={passwordEl}
					bind:value={passwordInput}
					onkeydown={onPasswordKeydown}
					type="password"
					class="password"
					disabled={passwordError}
					autocapitalize="off"
					autocomplete="off"
					spellcheck="false"
					aria-label="Exit password"
				/>
				{#if passwordError}<p class="password-error">Sorry, incorrect password.</p>{/if}
			{:else}
				<p class="exit-instruction">Press Enter to exit Word Judge.</p>
			{/if}
			<p class="exit-hint">press Esc to keep judging</p>
		</div>
	{:else if result}
		<div class="result" class:acceptable={result.acceptable} class:unacceptable={!result.acceptable}>
			<Tile glyph={result.acceptable ? '✓' : '✕'} tone={result.acceptable ? 'valid' : 'invalid'} size="min(22vh, 12rem)" />
			<div class="ruling">
				the play is <strong>{result.acceptable ? 'ACCEPTABLE' : 'UNACCEPTABLE'}</strong>
			</div>
			<div class="play">{result.words.join('  ·  ')}</div>
			<div class="hint">press any key for the next play</div>
		</div>
	{:else}
		<div class="prompt">
			<p class="instruction">Type the play — one word per line.</p>
			<textarea
				bind:this={inputEl}
				bind:value={input}
				onkeydown={onInputKeydown}
				oninput={onInput}
				rows="3"
				spellcheck="false"
				autocapitalize="characters"
				autocomplete="off"
				aria-label="Words to judge, one per line"
			></textarea>
			<p class="enter">Enter for the next word · Tab to judge</p>
		</div>
	{/if}

	<footer>
		<span class="lex">Word Judge · {lexicon}</span>
		<span class="exit">
			{#if exiting}
				press Esc to keep judging
			{:else}
				press Esc to exit{password ? ' (password required)' : ''}
			{/if}
		</span>
	</footer>
</div>

<style>
	.kiosk {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: var(--bg);
		color: var(--text);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		cursor: none;
		user-select: none;
		padding: 4vh 6vw;
	}

	.prompt {
		width: min(90vw, 60rem);
		text-align: center;
	}

	.instruction {
		color: var(--muted);
		font-size: clamp(1rem, 2.5vw, 1.6rem);
		margin: 0 0 1.5rem;
	}

	textarea {
		width: 100%;
		resize: none;
		background: var(--surface);
		color: var(--text);
		border: 2px solid var(--border);
		border-radius: 0.6rem;
		padding: 1rem 1.25rem;
		font-family: var(--font-word);
		font-size: clamp(2rem, 7vw, 5rem);
		line-height: 1.1;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-align: center;
		outline: none;
		caret-color: var(--accent);
	}

	textarea:focus {
		border-color: var(--accent);
	}

	.enter {
		color: var(--muted);
		font-size: clamp(0.9rem, 2vw, 1.25rem);
		margin: 1.5rem 0 0;
	}

	.exit-screen {
		width: min(90vw, 50rem);
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2vh;
	}

	.exit-instruction {
		color: var(--text);
		font-size: clamp(1.25rem, 3.5vw, 2.25rem);
		margin: 0;
	}

	.password {
		width: min(70vw, 24rem);
		background: var(--surface);
		color: var(--text);
		border: 2px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.75rem 1rem;
		font-family: var(--font-word);
		font-size: clamp(1.5rem, 4vw, 2.5rem);
		letter-spacing: 0.3em;
		text-align: center;
		outline: none;
		caret-color: var(--accent);
	}

	.password:focus {
		border-color: var(--accent);
	}

	.password:disabled {
		opacity: 0.6;
	}

	.password-error {
		color: var(--invalid);
		font-size: clamp(1rem, 2.5vw, 1.5rem);
		margin: 0;
	}

	.exit-hint {
		color: var(--muted);
		font-size: clamp(0.85rem, 1.8vw, 1.1rem);
		margin: 0;
	}

	.result {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		width: min(92vw, 64rem);
		gap: 2vh;
	}

	.ruling {
		font-size: clamp(1.25rem, 4vw, 2.75rem);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.result.acceptable .ruling strong {
		color: var(--valid);
	}
	.result.unacceptable .ruling strong {
		color: var(--invalid);
	}

	.play {
		margin-top: 2rem;
		font-family: var(--font-word);
		font-size: clamp(1.1rem, 3.5vw, 2.25rem);
		letter-spacing: 0.1em;
		color: var(--text);
		word-break: break-word;
	}

	.hint {
		margin-top: 2.5rem;
		color: var(--muted);
		font-size: clamp(0.85rem, 1.8vw, 1.1rem);
	}

	footer {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		color: var(--muted);
		font-size: 0.85rem;
		letter-spacing: 0.04em;
	}

	.lex {
		font-family: var(--font-word);
	}
</style>
