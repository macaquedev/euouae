<script lang="ts" generics="T">
	// Windowed list: only the rows intersecting the viewport are in the DOM, so a
	// quarter-million results scroll as smoothly as ten. Rows are a fixed height,
	// which keeps the maths exact and avoids per-row measurement. Each rendered
	// item is wrapped in a cell of exactly `itemHeight`, so callers don't have to
	// match the height themselves.
	//
	// An optional sticky `header` lives inside the scroll viewport, so it shares
	// the rows' content width — including any scrollbar gutter — and a column grid
	// applied to both stays aligned. The window start is offset by the header's
	// height so the first row sits just beneath it.
	import type { Snippet } from 'svelte';

	// Any ordered source with a length and a slice — a plain array, or a lazily
	// hydrated window that only fetches the rows a slice actually needs.
	interface Windowed<I> {
		readonly length: number;
		slice(start: number, end: number): I[];
	}

	interface Props {
		items: Windowed<T>;
		itemHeight: number;
		/** CSS height of the scroll viewport. */
		height?: string;
		/** Extra rows rendered above and below the viewport to mask fast scrolls. */
		overscan?: number;
		item: Snippet<[T, number]>;
		header?: Snippet;
	}

	let { items, itemHeight, height = '70vh', overscan = 8, item, header }: Props = $props();

	let viewport = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let clientHeight = $state(0);
	let headerHeight = $state(0);

	const first = $derived(Math.floor((scrollTop - headerHeight) / itemHeight));
	const start = $derived(Math.max(0, first - overscan));
	const visibleCount = $derived(Math.ceil(clientHeight / itemHeight) + overscan * 2);
	const visible = $derived(items.slice(start, start + visibleCount));

	// Reset to the top whenever the underlying list changes (e.g. a new search).
	$effect(() => {
		items;
		if (viewport) viewport.scrollTop = 0;
		scrollTop = 0;
	});
</script>

<div
	class="viewport"
	bind:this={viewport}
	bind:clientHeight
	style:height
	onscroll={() => (scrollTop = viewport?.scrollTop ?? 0)}
>
	{#if header}
		<div class="header" bind:clientHeight={headerHeight}>
			{@render header()}
		</div>
	{/if}
	<div class="runway" style:height="{items.length * itemHeight}px">
		<div class="window" style:transform="translateY({start * itemHeight}px)">
			{#each visible as entry, i (start + i)}
				<div class="cell" style:height="{itemHeight}px">
					{@render item(entry, start + i)}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.viewport {
		overflow-y: auto;
		overflow-x: hidden;
		position: relative;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		scrollbar-gutter: stable;
	}
	.header {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--surface);
	}
	.runway {
		position: relative;
		width: 100%;
	}
	.window {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		will-change: transform;
	}
	.cell {
		box-sizing: border-box;
		overflow: hidden;
	}
</style>
