<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { NAV } from '$lib/keyboard/nav';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';

	const dur = overlayDuration();

	let closeEl = $state<HTMLButtonElement | null>(null);
	// Focus starts outside the dialog (whatever triggered "?"), so without an
	// explicit focus here Tab's first press follows the page's normal tab order
	// instead of the trap — trapFocus only intercepts Tab once focus is already
	// inside the trapped node.
	$effect(() => closeEl?.focus());

	interface Row {
		keys: string[];
		desc: string;
	}

	const groups: { title: string; rows: Row[] }[] = [
		{
			title: 'Anywhere',
			rows: [
				{ keys: ['Ctrl', 'K'], desc: 'Open the command palette' },
				{ keys: ['?'], desc: 'Show this help' },
				{ keys: ['Esc'], desc: 'Close a dialog or clear input' }
			]
		},
		{
			title: 'Jump to',
			rows: [
				...NAV.map((n) => ({ keys: ['g', n.key], desc: n.label })),
				{ keys: ['g', 'x'], desc: 'Switch lexicon' }
			]
		},
		{
			title: 'On a page',
			rows: [
				{ keys: ['Enter'], desc: 'Run the primary action (rule, search, submit)' },
				{ keys: ['Tab'], desc: 'Move to the next control' },
				{ keys: ['↑', '↓'], desc: 'Move through results and lists' }
			]
		}
	];
</script>

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" tabindex="-1" aria-label="Close help" onclick={() => kbd.close()}></button>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label="Keyboard shortcuts"
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
		use:trapFocus
	>
		<header>
			<h2>Keyboard shortcuts</h2>
			<p class="muted">Everything here works without the mouse.</p>
			<button
				type="button"
				class="close"
				bind:this={closeEl}
				aria-label="Close"
				onclick={() => kbd.close()}
			>✕</button>
		</header>

		<div class="grid">
			{#each groups as group (group.title)}
				<section>
					<h3 class="eyebrow">{group.title}</h3>
					<dl>
						{#each group.rows as row (row.desc)}
							<div class="row">
								<dt>
									{#each row.keys as k, i (i)}
										<kbd class="kbd">{k}</kbd>{#if i < row.keys.length - 1 && group.title === 'Jump to'}<span class="then">then</span>{/if}
									{/each}
								</dt>
								<dd>{row.desc}</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
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
		align-items: center;
		padding: var(--s5);
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: rgba(4, 7, 5, 0.6);
		backdrop-filter: blur(3px);
		cursor: default;
	}
	.sheet {
		position: relative;
		width: min(94vw, 44rem);
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		padding: var(--s5);
	}

	header {
		position: relative;
		margin-bottom: var(--s5);
	}
	.close {
		position: absolute;
		top: 0;
		right: 0;
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: var(--r);
		color: var(--ink-faint);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.close:hover {
		color: var(--ink);
		background: var(--surface-2);
	}
	.close:focus-visible {
		outline: 2px solid var(--maple);
		outline-offset: 2px;
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}
	header p {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--s5);
	}
	h3 {
		margin: 0 0 var(--s3);
	}
	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	dt {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: 0 0 6.5rem;
	}
	dd {
		margin: 0;
		color: var(--ink-dim);
		font-size: 0.9rem;
	}
	.then {
		color: var(--ink-faint);
		font-size: 0.72rem;
		margin: 0 0.1rem;
	}
</style>
