<script lang="ts">
	import { fly } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { deleteCustomLexicon } from '$lib/lexicon/registry';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import CreateLexiconDialog from './CreateLexiconDialog.svelte';
	import ConfirmModal from './ConfirmModal.svelte';

	const dur = overlayDuration();

	let showCreate = $state(false);
	let pendingDelete = $state<string | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);

	const status = $derived(lexicon.error ? 'error' : lexicon.engine ? 'ready' : 'loading');
	const bundled = $derived(lexicon.available.filter((l) => l.kind === 'bundled'));
	const custom = $derived(lexicon.available.filter((l) => l.kind === 'custom'));

	function choose(name: string) {
		lexicon.select(name);
		kbd.close();
	}

	function onCreated(name: string) {
		showCreate = false;
		lexicon.refresh().then(() => lexicon.select(name));
	}

	async function confirmDelete() {
		const name = pendingDelete;
		pendingDelete = null;
		kbd.close();
		if (!name) return;
		await deleteCustomLexicon(name);
		await lexicon.forget(name);
	}

	// Jump straight into the menu when it opens, so a keyboard user never lands
	// on the invisible click-outside-to-close backdrop first.
	$effect(() => {
		if (kbd.lexiconPicker) {
			(menuEl?.querySelector<HTMLElement>('.item.current') ??
				menuEl?.querySelector<HTMLElement>('.item'))?.focus();
		}
	});

	// Up/Down roves focus between the lexicon buttons themselves (trash buttons
	// are Tab-reachable but not part of this list — arrowing through lexicons
	// shouldn't also stop on their delete controls).
	function onMenuKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const items = Array.from(menuEl?.querySelectorAll<HTMLElement>('.item') ?? []);
		if (!items.length) return;
		event.preventDefault();
		const current = items.indexOf(document.activeElement as HTMLElement);
		const next =
			event.key === 'ArrowDown'
				? (current + 1) % items.length
				: (current - 1 + items.length) % items.length;
		items[next]?.focus();
	}

</script>

<div class="picker">
	<button
		class="lex"
		data-status={status}
		aria-haspopup="listbox"
		aria-expanded={kbd.lexiconPicker}
		title={`Lexicon: ${status}`}
		onclick={() => (kbd.lexiconPicker ? kbd.close() : kbd.openLexiconPicker())}
	>
		<span class="dot"></span>
		<span class="active-name">{lexicon.name}</span>
		<span class="chev" class:up={kbd.lexiconPicker}>▾</span>
	</button>

	{#if kbd.lexiconPicker}
		<button
			class="backdrop"
			tabindex="-1"
			aria-label="Close lexicon picker"
			onclick={() => kbd.close()}
		></button>
		<!-- Each option is its own focusable button (Tab already moves between
		     them via trapFocus); the listbox itself is never a tab stop — this
		     onkeydown just adds Up/Down as a shortcut on top of that, so it
		     doesn't need its own tabindex. -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="menu"
			role="listbox"
			bind:this={menuEl}
			use:trapFocus
			onkeydown={onMenuKeydown}
			transition:fly={{ y: -4, duration: dur }}
		>
			<p class="group">Built-in</p>
			{#each bundled as l (l.name)}
				<button
					class="item"
					class:current={l.name === lexicon.name}
					role="option"
					aria-selected={l.name === lexicon.name}
					onclick={() => choose(l.name)}
				>
					<span class="name">{l.name}</span>
					<span class="meta">{l.alphabet.name}</span>
				</button>
			{/each}

			{#if custom.length}
				<p class="group">Custom</p>
				{#each custom as l (l.name)}
					<div class="item-row" class:current={l.name === lexicon.name}>
						<button
							class="item grow"
							role="option"
							aria-selected={l.name === lexicon.name}
							onclick={() => choose(l.name)}
						>
							<span class="name">{l.name}</span>
							<span class="meta">
								{l.alphabet.name}{#if l.wordCount} · {l.wordCount.toLocaleString()} words{/if}
							</span>
						</button>
						<button
							class="trash"
							title={`Delete ${l.name}`}
							aria-label={`Delete ${l.name}`}
							onclick={() => (pendingDelete = l.name)}
						>
							✕
						</button>
					</div>
				{/each}
			{/if}

			<button class="item create" onclick={() => { kbd.close(); showCreate = true; }}>
				+ Create custom…
			</button>
		</div>
	{/if}
</div>

{#if showCreate}
	<CreateLexiconDialog oncreated={onCreated} oncancel={() => (showCreate = false)} />
{/if}

{#if pendingDelete}
	<ConfirmModal
		title="Delete custom lexicon"
		message={`Delete "${pendingDelete}"? Its word data is removed; saved lists and card progress under this lexicon are kept.`}
		confirmLabel="Delete"
		danger
		requireText={pendingDelete}
		onconfirm={confirmDelete}
		oncancel={() => (pendingDelete = null)}
	/>
{/if}

<style>
	.picker {
		position: relative;
	}

	.lex {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-word);
		font-size: 0.78rem;
		color: var(--ink-dim);
		padding: 0.25rem 0.55rem 0.25rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: transparent;
	}
	.lex:hover {
		border-color: var(--line-strong);
		color: var(--ink);
	}
	.active-name {
		font-weight: 500;
	}
	.chev {
		font-size: 0.7rem;
		transition: transform var(--t-fast) var(--ease);
	}
	.chev.up {
		transform: rotate(180deg);
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ink-faint);
	}
	.lex[data-status='ready'] .dot {
		background: var(--valid);
		box-shadow: 0 0 8px var(--valid);
	}
	.lex[data-status='loading'] .dot {
		background: var(--maple);
		animation: pulse 1.1s var(--ease) infinite;
	}
	.lex[data-status='error'] .dot {
		background: var(--invalid);
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 55;
		background: none;
		border: none;
		cursor: default;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		z-index: 60;
		min-width: 15rem;
		max-height: 70vh;
		overflow-y: auto;
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		padding: 0.35rem;
	}
	.group {
		margin: 0.3rem 0.55rem 0.2rem;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
	}

	.item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.05rem;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		border-radius: var(--r-sm);
		padding: 0.4rem 0.55rem;
		color: var(--ink);
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface-2);
	}
	.item.current {
		color: var(--maple);
	}
	.item .name {
		font-weight: 500;
		font-size: 0.9rem;
	}
	.item .meta {
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	.item-row {
		display: flex;
		align-items: stretch;
		border-radius: var(--r-sm);
	}
	.item-row:hover {
		background: var(--surface-2);
	}
	.item-row.current .name {
		color: var(--maple);
	}
	.item-row .grow {
		flex: 1;
	}
	.item-row .item:hover {
		background: transparent;
	}
	.trash {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		padding: 0 0.6rem;
		border-radius: var(--r-sm);
		font-size: 0.8rem;
	}
	.trash:hover {
		color: var(--invalid);
		background: var(--invalid-wash);
	}

	.create {
		margin-top: 0.2rem;
		border-top: 1px solid var(--line);
		border-radius: 0 0 var(--r-sm) var(--r-sm);
		color: var(--ink-dim);
		font-size: 0.86rem;
		flex-direction: row;
	}
	.create:hover {
		color: var(--maple);
	}
</style>
