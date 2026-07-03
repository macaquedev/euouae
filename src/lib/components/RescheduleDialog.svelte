<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';

	interface Props {
		listName: string;
		onconfirm: (days: number) => void;
		oncancel: () => void;
	}

	let { listName, onconfirm, oncancel }: Props = $props();

	const dur = overlayDuration();

	// Matches Zyzzyva's reschedule dialog: 0 means nothing entered yet (Confirm
	// stays disabled), positive pushes due dates later, negative pulls them
	// earlier — even into "overdue, due now" territory.
	let days = $state(0);
	let daysEl = $state<HTMLInputElement | null>(null);

	$effect(() => daysEl?.focus());

	// Not registered with kbd's palette/help/lexiconPicker set, so lock the
	// global "g <key>" / Ctrl+K handlers directly — otherwise they fire right
	// through this dialog whenever a button (not a text field) has focus.
	$effect(() => {
		kbd.lock();
		return () => kbd.unlock();
	});

	const ready = $derived(Number.isInteger(days) && days !== 0);
	const hint = $derived(
		days === 0 ? '' : `Shift due dates ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}.`
	);

	function confirm() {
		if (!ready) return;
		onconfirm(days);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			oncancel();
		} else if (event.key === 'Enter' && ready) {
			event.preventDefault();
			confirm();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" tabindex="-1" aria-label="Cancel" onclick={oncancel}></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label="Reschedule due dates"
		use:trapFocus
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<h2>Reschedule “{listName}”</h2>
		<p class="note">
			Shifts the next due date for every studied card in this list, under whichever
			scheduler it's quizzed with — both Cardbox and FSRS move together. Never-studied
			cards and Standard drilling are unaffected.
		</p>

		<label class="field">
			<span>Days to shift by</span>
			<input
				bind:this={daysEl}
				type="number"
				step="1"
				bind:value={days}
				placeholder="0"
				aria-label="Days to shift by"
			/>
		</label>
		{#if hint}
			<p class="hint">{hint}</p>
		{/if}

		<div class="actions">
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
			<button type="button" class="confirm" onclick={confirm} disabled={!ready}>Reschedule</button>
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
		padding-top: 12vh;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: var(--scrim);
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

	.note {
		margin: 0 0 var(--s4);
		font-size: 0.85rem;
		color: var(--ink-dim);
		line-height: 1.5;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.field > span {
		font-size: 0.85rem;
		color: var(--ink-dim);
	}
	input[type='number'] {
		width: 100%;
		background: var(--surface-2);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 0.5rem 0.7rem;
		font: inherit;
	}
	input[type='number']:focus {
		border-color: var(--maple);
		outline: none;
	}

	.hint {
		margin: var(--s2) 0 0;
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--s2);
		margin-top: var(--s5);
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
	.confirm:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
