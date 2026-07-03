<script lang="ts">
	// The signature element: a wooden Scrabble tile — a softly-cornered square
	// with a centred glyph and an optional point-value subscript. Used for the
	// brand mark, the Judge verdict, and accents throughout.
	interface Props {
		glyph: string;
		value?: number;
		tone?: 'maple' | 'valid' | 'invalid';
		size?: string;
	}
	let { glyph, value, tone = 'maple', size = '2.5rem' }: Props = $props();
</script>

<span class="tile {tone}" style:--tile={size} aria-hidden="true">
	<span class="glyph">{glyph}</span>
	{#if value !== undefined}<span class="val">{value}</span>{/if}
</span>

<style>
	.tile {
		position: relative;
		display: inline-grid;
		place-items: center;
		width: var(--tile);
		height: var(--tile);
		border-radius: calc(var(--tile) * 0.18);
		font-family: var(--font-word);
		font-weight: 600;
		user-select: none;
		/* Maple face: light top edge, slightly darker base — a real tile catches light.
		   Uses the fixed wood tokens, so the brand tile stays maple in every theme. */
		background: linear-gradient(160deg, var(--tile-hi) 0%, var(--tile-face) 55%, var(--tile-lo) 100%);
		color: var(--tile-ink);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.45),
			inset 0 -2px 3px rgba(0, 0, 0, 0.18),
			0 2px 4px rgba(0, 0, 0, 0.45);
	}

	.tile.valid {
		background: linear-gradient(160deg, #8defc0 0%, var(--valid) 55%, #34b27c 100%);
		color: #06140d;
	}
	.tile.invalid {
		background: linear-gradient(160deg, #ff948c 0%, var(--invalid) 55%, #c64a42 100%);
		color: #2a0a08;
	}

	.glyph {
		font-size: calc(var(--tile) * 0.56);
		line-height: 1;
		letter-spacing: 0.02em;
	}

	.val {
		position: absolute;
		right: calc(var(--tile) * 0.12);
		bottom: calc(var(--tile) * 0.06);
		font-size: calc(var(--tile) * 0.22);
		font-weight: 600;
		opacity: 0.75;
	}
</style>
