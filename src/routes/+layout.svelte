<script lang="ts">
	import '../app.css';
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/ibm-plex-sans/700.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '@fontsource/ibm-plex-mono/600.css';

	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { NAV } from '$lib/keyboard/nav';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import Tile from '$lib/components/Tile.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ShortcutsHelp from '$lib/components/ShortcutsHelp.svelte';

	let { children } = $props();

	const reduce =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	onMount(() => lexicon.load());

	const path = $derived(page.url.pathname.replace(base, '').replace(/\/$/, ''));
	const isActive = (href: string) => (href === '' ? path === '' : path === `/${href}`);

	const status = $derived(
		lexicon.error ? 'error' : lexicon.engine ? 'ready' : 'loading'
	);

	// "g then <key>" jump navigation, only when not typing in a field.
	let gPending = false;
	let gTimer: ReturnType<typeof setTimeout> | undefined;

	function isEditable(el: EventTarget | null): boolean {
		const node = el as HTMLElement | null;
		if (!node) return false;
		return (
			node.isContentEditable ||
			node.tagName === 'INPUT' ||
			node.tagName === 'TEXTAREA' ||
			node.tagName === 'SELECT'
		);
	}

	function onKeydown(event: KeyboardEvent) {
		// Command palette: reachable everywhere, even mid-typing.
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			kbd.palette ? kbd.close() : kbd.openPalette();
			return;
		}
		if (kbd.anyOpen) {
			if (event.key === 'Escape') {
				event.preventDefault();
				kbd.close();
			}
			return;
		}

		if (isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
			event.preventDefault();
			kbd.openHelp();
			return;
		}
		if (gPending) {
			gPending = false;
			clearTimeout(gTimer);
			const item = NAV.find((n) => n.key === event.key.toLowerCase());
			if (item) {
				event.preventDefault();
				goto(`${base}/${item.href}`);
			}
			return;
		}
		if (event.key.toLowerCase() === 'g') {
			gPending = true;
			clearTimeout(gTimer);
			gTimer = setTimeout(() => (gPending = false), 1200);
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onkeydown={onKeydown} oncontextmenu={(e) => e.preventDefault()} />

<a class="skip" href="#main">Skip to content</a>

<div class="shell">
	<header class="topbar">
		<a class="brand" href="{base}/" aria-label="euouae — home">
			<Tile glyph="E" value={1} size="1.7rem" />
			<span class="wordmark">euouae</span>
		</a>

		<nav aria-label="Primary">
			{#each NAV as item (item.href)}
				<a
					class="navlink"
					class:active={isActive(item.href)}
					href="{base}/{item.href}"
					title="g {item.key}"
					aria-current={isActive(item.href) ? 'page' : undefined}
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="tools">
			<button
				class="cmd"
				onclick={() => kbd.openPalette()}
				aria-label="Open command palette"
				title="Command palette"
			>
				<kbd class="kbd">⌘</kbd><kbd class="kbd">K</kbd>
			</button>
			<button class="help" onclick={() => kbd.openHelp()} aria-label="Keyboard shortcuts" title="Shortcuts">
				?
			</button>
			<span class="lex" data-status={status} title={`Lexicon: ${status}`}>
				<span class="dot"></span>
				{lexicon.name}
			</span>
		</div>
	</header>

	{#if lexicon.error}
		<p class="load-error" role="alert">
			Couldn't load the {lexicon.name} lexicon: {lexicon.error}
		</p>
	{/if}

	<main id="main">
		{#key path}
			<div in:fly={{ y: reduce ? 0 : 6, duration: reduce ? 0 : 180 }}>
				{@render children()}
			</div>
		{/key}
	</main>
</div>

{#if kbd.palette}
	<CommandPalette />
{/if}
{#if kbd.help}
	<ShortcutsHelp />
{/if}

<style>
	.shell {
		min-height: 100%;
		display: flex;
		flex-direction: column;
	}

	.skip {
		position: fixed;
		top: 0;
		left: 0;
		transform: translateY(-120%);
		z-index: 1100;
		background: var(--maple);
		color: var(--on-maple);
		padding: 0.5rem 1rem;
		border-radius: 0 0 var(--r) 0;
		font-weight: 600;
		text-decoration: none;
		transition: transform var(--t) var(--ease);
	}
	.skip:focus-visible {
		transform: translateY(0);
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: var(--s5);
		padding: 0.65rem var(--s5);
		background: rgba(12, 16, 14, 0.82);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--s2);
		text-decoration: none;
		color: var(--ink);
	}
	.wordmark {
		font-family: var(--font-word);
		font-weight: 600;
		font-size: 1.05rem;
		letter-spacing: 0.02em;
	}

	nav {
		display: flex;
		gap: 0.15rem;
	}
	.navlink {
		position: relative;
		padding: 0.4rem 0.7rem;
		border-radius: var(--r-sm);
		color: var(--ink-dim);
		text-decoration: none;
		font-size: 0.92rem;
		font-weight: 500;
		transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
	}
	.navlink:hover {
		color: var(--ink);
		background: var(--surface-2);
	}
	.navlink.active {
		color: var(--maple);
	}
	/* Active marker: a tile-amber underline (Gestalt: common region for "where am I"). */
	.navlink.active::after {
		content: '';
		position: absolute;
		left: 0.7rem;
		right: 0.7rem;
		bottom: -0.66rem;
		height: 2px;
		background: var(--maple);
		border-radius: var(--r-pill);
	}

	.tools {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	.cmd {
		display: flex;
		gap: 0.2rem;
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--surface-1);
	}
	.cmd:hover {
		border-color: var(--line-strong);
	}
	.help {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: var(--r-sm);
		border: 1px solid var(--line);
		color: var(--ink-dim);
		font-family: var(--font-word);
	}
	.help:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.lex {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-word);
		font-size: 0.78rem;
		color: var(--ink-dim);
		padding: 0.25rem 0.6rem 0.25rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
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

	.load-error {
		margin: var(--s4) var(--s5) 0;
		color: var(--invalid);
		background: var(--invalid-wash);
		border: 1px solid var(--invalid);
		border-radius: var(--r);
		padding: 0.75rem 1rem;
	}

	main {
		flex: 1;
	}

	@media (max-width: 640px) {
		.topbar {
			flex-wrap: wrap;
			gap: var(--s3);
		}
		nav {
			order: 3;
			width: 100%;
			overflow-x: auto;
		}
	}
</style>
