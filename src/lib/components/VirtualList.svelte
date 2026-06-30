<script lang="ts" generics="T">
	// Windowed list: only the rows intersecting the viewport are in the DOM, so a
	// quarter-million results scroll as smoothly as ten. `itemHeight` is either one
	// fixed height for every row (the simple, exact-math case) or a per-index
	// getter for variable-height rows (e.g. a row that wraps onto extra lines) —
	// in that case a cumulative-offset table is built once per `items` change and
	// scroll position is found with a binary search, so a million variable rows
	// cost the same to scroll as a million fixed ones. Each rendered item is
	// wrapped in a cell of exactly its row's height, so callers don't have to
	// match it themselves.
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
		/** A fixed height (px) for every row, or `(index) => height` for rows whose
		 *  height varies (e.g. by content). The getter is read once per row when
		 *  `items`/`itemHeight` change to build the offset table, not on every
		 *  scroll frame. */
		itemHeight: number | ((index: number) => number);
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

	// offsets[i] is the y-position (within the runway) where row i starts;
	// offsets[length] is the total runway height. Built fresh whenever `items` or
	// `itemHeight` changes — O(n) over plain numbers, cheap even for tens of
	// thousands of rows — so scrolling itself never re-walks the whole list.
	const offsets = $derived.by(() => {
		const n = items.length;
		const out = new Array<number>(n + 1);
		if (typeof itemHeight === 'number') {
			for (let i = 0; i <= n; i++) out[i] = i * itemHeight;
		} else {
			let acc = 0;
			for (let i = 0; i < n; i++) {
				out[i] = acc;
				acc += itemHeight(i);
			}
			out[n] = acc;
		}
		return out;
	});

	const totalHeight = $derived(offsets[items.length] ?? 0);

	/** The row covering offset `y` into the runway (clamped to a valid index). */
	function indexAt(y: number): number {
		const n = items.length;
		if (n === 0) return 0;
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (offsets[mid] <= y) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	const first = $derived(indexAt(Math.max(0, scrollTop - headerHeight)));
	const start = $derived(Math.max(0, first - overscan));
	// How many rows from `start` fill the viewport, walking actual offsets rather
	// than dividing by a uniform height — bounded by what's on screen, never by
	// the list's total length.
	const end = $derived.by(() => {
		const limit = scrollTop - headerHeight + clientHeight;
		const n = items.length;
		let i = start;
		while (i < n && offsets[i] < limit) i++;
		return Math.min(n, i + overscan);
	});
	const visible = $derived(items.slice(start, end));

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
	<div class="runway" style:height="{totalHeight}px">
		<div class="window" style:transform="translateY({offsets[start] ?? 0}px)">
			{#each visible as entry, i (start + i)}
				<div class="cell" style:height="{offsets[start + i + 1] - offsets[start + i]}px">
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
