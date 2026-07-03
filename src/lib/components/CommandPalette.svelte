<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { NAV } from '$lib/keyboard/nav';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { overlayDuration } from '$lib/motion';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { updater } from '$lib/updater/updater.svelte';
	import { theme } from '$lib/theme/theme.svelte';

	interface Command {
		id: string;
		label: string;
		hint: string;
		group: string;
		shortcut: string[];
		/** Opens another overlay itself, so running it must not close the palette first. */
		swaps?: boolean;
		run: () => void;
	}

	const dur = overlayDuration();

	let query = $state('');
	let index = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	const commands = $derived<Command[]>([
		...NAV.map((n) => ({
			id: `nav-${n.href || 'judge'}`,
			label: n.label,
			hint: n.hint,
			group: 'Go to',
			shortcut: ['g', n.key],
			run: () => goto(`${base}/${n.href}`)
		})),
		{
			id: 'lexicon-switch',
			label: 'Switch lexicon',
			hint: `Currently ${lexicon.name}`,
			group: 'Lexicon',
			shortcut: ['g', 'x'],
			swaps: true,
			run: () => kbd.openLexiconPicker()
		},
		{
			id: 'theme',
			label: 'Change theme',
			hint: `Currently ${theme.theme.label}`,
			group: 'Appearance',
			shortcut: [],
			swaps: true,
			run: () => kbd.openTheme()
		},
		{
			id: 'tilesets',
			label: 'Manage tile sets',
			hint: 'Save, import and export custom letter bags',
			group: 'Lexicon',
			shortcut: [],
			swaps: true,
			run: () => kbd.openAlphabets()
		},
		{
			id: 'progress',
			label: 'Back up or restore progress',
			hint: 'Export everything to a file, or import a backup',
			group: 'Data',
			shortcut: [],
			swaps: true,
			run: () => kbd.openProgress()
		},
		...(updater.supported
			? [
					{
						id: 'check-updates',
						label: 'Check for updates',
						hint: 'See if a newer version is available',
						group: 'Data',
						shortcut: [],
						run: () => void updater.checkNow()
					}
				]
			: []),
		{
			id: 'help',
			label: 'Keyboard shortcuts',
			hint: 'See everything you can do from the keyboard',
			group: 'Help',
			shortcut: ['?'],
			swaps: true,
			run: () => kbd.openHelp()
		}
	]);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return commands;
		return commands.filter((c) => `${c.label} ${c.hint} ${c.group}`.toLowerCase().includes(q));
	});

	$effect(() => {
		if (index > filtered.length - 1) index = Math.max(0, filtered.length - 1);
	});
	$effect(() => {
		inputEl?.focus();
	});
	$effect(() => {
		document.getElementById(`cmd-${index}`)?.scrollIntoView({ block: 'nearest' });
	});

	function run(cmd: Command) {
		if (cmd.swaps) {
			cmd.run(); // opens another overlay itself; don't close first
		} else {
			kbd.close();
			cmd.run();
		}
	}

	function onKeydown(event: KeyboardEvent) {
		const n = filtered.length;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			index = n ? (index + 1) % n : 0;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			index = n ? (index - 1 + n) % n : 0;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (filtered[index]) run(filtered[index]);
		} else if (event.key === 'Tab') {
			event.preventDefault(); // trap focus in the palette
		}
	}
</script>

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" aria-label="Close command palette" onclick={() => kbd.close()}></button>
	<div
		class="palette"
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<div class="search">
			<span class="prompt" aria-hidden="true">&gt;</span>
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onKeydown}
				type="text"
				placeholder="Jump to a page or command…"
				role="combobox"
				aria-expanded="true"
				aria-controls="cmd-list"
				aria-activedescendant={filtered.length ? `cmd-${index}` : undefined}
				autocomplete="off"
				spellcheck="false"
			/>
		</div>

		<ul id="cmd-list" role="listbox" aria-label="Commands">
			{#each filtered as cmd, i (cmd.id)}
				<!-- Keyboard handling lives on the combobox input (listbox pattern); mouse is a convenience. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="cmd-{i}"
					role="option"
					aria-selected={i === index}
					class:active={i === index}
					onmousemove={() => (index = i)}
					onclick={() => run(cmd)}
				>
					<span class="group">{cmd.group}</span>
					<span class="label">{cmd.label}</span>
					<span class="hint">{cmd.hint}</span>
					<span class="sc">
						{#each cmd.shortcut as k (k)}<kbd class="kbd">{k}</kbd>{/each}
					</span>
				</li>
			{:else}
				<li class="empty">No matching commands</li>
			{/each}
		</ul>
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
	.palette {
		position: relative;
		width: min(92vw, 38rem);
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--s3);
		padding: var(--s3) var(--s4);
		border-bottom: 1px solid var(--line);
	}
	.prompt {
		font-family: var(--font-word);
		color: var(--maple);
	}
	.search input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		color: var(--ink);
		font: inherit;
		font-size: 1.05rem;
	}
	.search input::placeholder {
		color: var(--ink-faint);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: var(--s2);
		max-height: 50vh;
		overflow-y: auto;
	}
	li {
		display: grid;
		grid-template-columns: 4.5rem max-content minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--s3);
		padding: 0.55rem 0.7rem;
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	li.active {
		background: var(--surface-3);
	}
	li.active .label {
		color: var(--maple);
	}
	.group {
		font-family: var(--font-word);
		font-size: 0.66rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-faint);
		text-align: right;
	}
	.label {
		font-weight: 500;
	}
	.hint {
		color: var(--ink-dim);
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sc {
		display: flex;
		gap: 0.25rem;
	}
	.empty {
		display: block;
		padding: var(--s4);
		color: var(--ink-faint);
		text-align: center;
		cursor: default;
	}
	li.empty:hover {
		background: none;
	}
</style>
