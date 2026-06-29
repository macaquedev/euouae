<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import {
		ALL_ATTRIBUTES,
		ATTRIBUTE_LABELS,
		FORMATS,
		FORMAT_LABELS,
		formatUsesAttributes,
		type ExportAttribute,
		type ExportFormat
	} from '$lib/userdata/export';

	interface Props {
		listName: string;
		onconfirm: (opts: { format: ExportFormat; attributes: ExportAttribute[] }) => void;
		oncancel: () => void;
	}

	let { listName, onconfirm, oncancel }: Props = $props();

	const reduce =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const dur = reduce ? 0 : 150;

	let format = $state<ExportFormat>('one-per-line');

	// One ordered row per attribute; export order is the order of the checked rows.
	// Defaults match Zyzzyva: only Word selected, sitting at the top.
	let rows = $state(ALL_ATTRIBUTES.map((attr) => ({ attr, selected: attr === 'word' })));

	const usesAttributes = $derived(formatUsesAttributes(format));
	const anySelected = $derived(rows.some((r) => r.selected));
	const ready = $derived(!usesAttributes || anySelected);

	function move(index: number, delta: number) {
		const next = index + delta;
		if (next < 0 || next >= rows.length) return;
		[rows[index], rows[next]] = [rows[next], rows[index]];
	}

	function confirm() {
		if (!ready) return;
		const attributes = usesAttributes
			? rows.filter((r) => r.selected).map((r) => r.attr)
			: [];
		onconfirm({ format, attributes });
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
	<button class="backdrop" aria-label="Cancel" onclick={oncancel}></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label="Export word list"
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<h2>Export “{listName}”</h2>

		<label class="field">
			<span>Format</span>
			<select bind:value={format}>
				{#each FORMATS as f (f)}
					<option value={f}>{FORMAT_LABELS[f]}</option>
				{/each}
			</select>
		</label>

		<div class="attrs" class:disabled={!usesAttributes}>
			<span class="attrs-label">Attributes</span>
			<ul>
				{#each rows as row, i (row.attr)}
					<li>
						<label>
							<input
								type="checkbox"
								bind:checked={row.selected}
								disabled={!usesAttributes}
							/>
							<span>{ATTRIBUTE_LABELS[row.attr]}</span>
						</label>
						<span class="reorder">
							<button
								type="button"
								aria-label="Move up"
								disabled={!usesAttributes || i === 0}
								onclick={() => move(i, -1)}>↑</button
							>
							<button
								type="button"
								aria-label="Move down"
								disabled={!usesAttributes || i === rows.length - 1}
								onclick={() => move(i, 1)}>↓</button
							>
						</span>
					</li>
				{/each}
			</ul>
			{#if !usesAttributes}
				<p class="note">Distinct Alphagrams exports one alphagram per line.</p>
			{/if}
		</div>

		<div class="actions">
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
			<button type="button" class="confirm" onclick={confirm} disabled={!ready}>Export</button>
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
		background: rgba(4, 7, 5, 0.6);
		backdrop-filter: blur(3px);
		cursor: default;
	}
	.modal {
		position: relative;
		width: min(92vw, 28rem);
		max-height: 80vh;
		overflow-y: auto;
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		padding: var(--s5);
	}

	h2 {
		margin: 0 0 var(--s4);
		font-size: 1.1rem;
		font-weight: 600;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		margin-bottom: var(--s4);
	}
	.field > span {
		font-size: 0.85rem;
		color: var(--ink-dim);
	}
	select {
		width: 100%;
		background: var(--surface-2);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 0.5rem 0.7rem;
		font: inherit;
		outline: none;
	}
	select:focus {
		border-color: var(--maple);
	}

	.attrs-label {
		display: block;
		font-size: 0.85rem;
		color: var(--ink-dim);
		margin-bottom: var(--s2);
	}
	.attrs.disabled {
		opacity: 0.55;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
		padding: 0.4rem 0.6rem;
	}
	li:not(:last-child) {
		border-bottom: 1px solid var(--line);
	}
	li label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		cursor: pointer;
		flex: 1;
	}
	li input[type='checkbox'] {
		accent-color: var(--maple);
	}
	.reorder {
		display: flex;
		gap: 0.25rem;
	}
	.reorder button {
		width: 1.6rem;
		height: 1.6rem;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		color: var(--ink-dim);
		line-height: 1;
	}
	.reorder button:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-strong);
	}
	.reorder button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.note {
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
