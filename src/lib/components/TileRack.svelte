<script lang="ts">
	// A read-only rack of the real maple tiles with their bag counts — the
	// signature preview of a tile set, shared by the lexicon builder and the
	// tile-set manager. Glyphs are shown as given (normalise before passing in).
	import Tile from './Tile.svelte';

	interface RackTile {
		glyph: string;
		value: number;
		frequency: number;
	}

	interface Props {
		tiles: readonly RackTile[];
		blankCount?: number;
		size?: string;
	}

	let { tiles, blankCount = 0, size = '2rem' }: Props = $props();
</script>

<div class="rack">
	{#each tiles as tile, i (i)}
		<span class="rack-cell">
			<Tile glyph={tile.glyph} value={tile.value} {size} />
			<span class="rack-count">×{tile.frequency}</span>
		</span>
	{/each}
	{#if blankCount > 0}
		<span class="rack-cell">
			<Tile glyph="?" {size} />
			<span class="rack-count">×{blankCount}</span>
		</span>
	{/if}
</div>

<style>
	.rack {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s3) var(--s2);
	}
	.rack-cell {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
	}
	.rack-count {
		font-family: var(--font-word);
		font-size: 0.66rem;
		color: var(--ink-faint);
	}
</style>
