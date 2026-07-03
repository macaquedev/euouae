<script lang="ts">
	// Appearance picker — a topbar dropdown that switches colour scheme. Mirrors
	// LexiconPicker's structure (trigger + backdrop + roving-focus listbox) so
	// the two menus behave identically and share the shell's overlay discipline.
	import { fly } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { theme, THEMES } from '$lib/theme/theme.svelte';

	const dur = overlayDuration();

	let menuEl = $state<HTMLDivElement | null>(null);

	const groups = [
		{ title: 'Dark', items: THEMES.filter((t) => t.mode === 'dark') },
		{ title: 'Light', items: THEMES.filter((t) => t.mode === 'light') }
	];

	function choose(id: string) {
		theme.set(id);
		kbd.close();
	}

	// Land straight on the active theme when the menu opens, never on the
	// invisible click-outside backdrop.
	$effect(() => {
		if (kbd.theme) {
			(menuEl?.querySelector<HTMLElement>('.item.current') ??
				menuEl?.querySelector<HTMLElement>('.item'))?.focus();
		}
	});

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
		class="trigger"
		aria-haspopup="listbox"
		aria-expanded={kbd.theme}
		aria-label={`Change theme (current: ${theme.theme.label})`}
		title={`Theme: ${theme.theme.label}`}
		onclick={() => (kbd.theme ? kbd.close() : kbd.openTheme())}
	>
		<span class="glyph" aria-hidden="true">◐</span>
	</button>

	{#if kbd.theme}
		<button class="backdrop" tabindex="-1" aria-label="Close theme picker" onclick={() => kbd.close()}
		></button>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="menu"
			role="listbox"
			aria-label="Theme"
			bind:this={menuEl}
			use:trapFocus
			onkeydown={onMenuKeydown}
			transition:fly={{ y: -4, duration: dur }}
		>
			{#each groups as group (group.title)}
				<p class="group">{group.title}</p>
				{#each group.items as t (t.id)}
					<button
						class="item"
						class:current={t.id === theme.current}
						role="option"
						aria-selected={t.id === theme.current}
						onclick={() => choose(t.id)}
					>
						<span class="chip" style:background={t.swatch.bg} aria-hidden="true">
							<span class="chip-dot" style:background={t.swatch.accent}></span>
							<span class="chip-bar" style:background={t.swatch.ink}></span>
						</span>
						<span class="text">
							<span class="name">{t.label}</span>
							<span class="blurb">{t.blurb}</span>
						</span>
						{#if t.id === theme.current}<span class="tick" aria-hidden="true">✓</span>{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
	}

	.trigger {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: var(--r-sm);
		border: 1px solid var(--line);
		color: var(--ink-dim);
		background: transparent;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		color: var(--ink);
		border-color: var(--line-strong);
	}
	.glyph {
		font-size: 1.05rem;
		line-height: 1;
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
		min-width: 16rem;
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
		align-items: center;
		gap: 0.6rem;
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
	.item.current .name {
		color: var(--maple);
	}

	/* A miniature preview of the scheme: paper, accent dot, ink bar. */
	.chip {
		position: relative;
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--r-sm);
		border: 1px solid var(--line-strong);
		overflow: hidden;
	}
	.chip-dot {
		position: absolute;
		top: 0.28rem;
		left: 0.28rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: var(--r-pill);
	}
	.chip-bar {
		position: absolute;
		left: 0.28rem;
		right: 0.28rem;
		bottom: 0.28rem;
		height: 0.32rem;
		border-radius: var(--r-pill);
		opacity: 0.85;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-weight: 500;
		font-size: 0.9rem;
	}
	.blurb {
		font-size: 0.74rem;
		color: var(--ink-faint);
	}
	.tick {
		color: var(--maple);
		font-size: 0.8rem;
	}
</style>
