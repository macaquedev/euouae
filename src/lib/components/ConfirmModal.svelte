<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';

	interface Props {
		title: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		// When set, the user must type this exact string before confirm is enabled —
		// used to guard irreversible actions like deleting a list by its name.
		requireText?: string;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		danger = false,
		requireText,
		onconfirm,
		oncancel
	}: Props = $props();

	const dur = overlayDuration();

	let typed = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let confirmEl = $state<HTMLButtonElement | null>(null);

	const ready = $derived(requireText === undefined || typed === requireText);

	// Focus the type-to-confirm field if there is one, else the confirm button so
	// Enter works immediately. Destructive deletes go through the field, so the
	// confirm button is never the default target for them.
	$effect(() => {
		if (requireText !== undefined) inputEl?.focus();
		else confirmEl?.focus();
	});

	// Not registered with kbd's palette/help/lexiconPicker set, so lock the
	// global "g <key>" / Ctrl+K handlers directly — otherwise they fire right
	// through this dialog whenever a button (not a text field) has focus.
	$effect(() => {
		kbd.lock();
		return () => kbd.unlock();
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			oncancel();
		} else if (event.key === 'Enter' && ready) {
			event.preventDefault();
			onconfirm();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" tabindex="-1" aria-label={cancelLabel} onclick={oncancel}></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		use:trapFocus
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<h2>{title}</h2>
		{#if message}<p class="message">{message}</p>{/if}
		{#if requireText !== undefined}
			<input
				bind:this={inputEl}
				bind:value={typed}
				type="text"
				placeholder={requireText}
				autocomplete="off"
				spellcheck="false"
			/>
		{/if}
		<div class="actions">
			<button type="button" class="cancel" onclick={oncancel}>{cancelLabel}</button>
			<button
				type="button"
				bind:this={confirmEl}
				class="confirm"
				class:danger
				onclick={onconfirm}
				disabled={!ready}
			>
				{confirmLabel}
			</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding-top: 16vh;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: rgba(4, 7, 5, 0.6);
		backdrop-filter: blur(3px);
		cursor: default;
	}
	.modal {
		position: relative;
		width: min(92vw, 26rem);
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		padding: var(--s5);
	}

	h2 {
		margin: 0 0 var(--s3);
		font-size: 1.1rem;
		font-weight: 600;
	}
	.message {
		margin: 0 0 var(--s4);
		color: var(--ink-dim);
		line-height: 1.45;
	}

	input {
		width: 100%;
		background: var(--surface-2);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 0.55rem 0.7rem;
		font: inherit;
		margin-bottom: var(--s4);
	}
	input:focus {
		border-color: var(--maple);
	}
	input::placeholder {
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--s2);
	}
	.cancel {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		color: var(--ink-dim);
		padding: 0.5rem 1rem;
	}
	.cancel:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}
	.confirm {
		background: var(--maple);
		color: var(--on-maple);
		border: 1px solid transparent;
		border-radius: var(--r-sm);
		padding: 0.5rem 1.1rem;
		font-weight: 600;
	}
	.confirm.danger {
		background: var(--invalid);
		color: #fff;
	}
	.confirm:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
