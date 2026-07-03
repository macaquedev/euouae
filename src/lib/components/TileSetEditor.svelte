<script lang="ts">
	// The full-width tile distribution table: one editable row per tile (glyph,
	// points, bag count, vowel) plus the fixed blanks row. Operates on a bindable
	// draft so its host owns the state — the lexicon builder and the tile-set
	// manager both mount this and read the same `tiles`/`blankCount` back out.
	// Validation lives in lexicon/tileset.ts; hosts surface it however they like.
	import type { Snippet } from 'svelte';
	import type { DraftTile } from '$lib/lexicon/tileset';

	interface Props {
		tiles: DraftTile[];
		blankCount: number;
		disabled?: boolean;
		/** Extra actions shown at the right of the editor's foot (e.g. Save, Done). */
		footer?: Snippet;
	}

	let {
		tiles = $bindable(),
		blankCount = $bindable(),
		disabled = false,
		footer
	}: Props = $props();

	function addTile() {
		tiles = [...tiles, { glyph: '', value: 1, frequency: 1, vowel: false }];
	}

	function removeTile(index: number) {
		tiles = tiles.filter((_, i) => i !== index);
	}
</script>

<div class="editor">
	<div class="table">
		<div class="thead">
			<div class="erow ehead" aria-hidden="true">
				<span class="c-tile">Tile</span>
				<span class="c-num">Points</span>
				<span class="c-num">In bag</span>
				<span class="c-vowel">Vowel</span>
				<span class="c-x"></span>
			</div>
			<!-- Blanks are a fixed tile: worth 0, never a vowel, can't be removed.
			     The bag count doubles as "how many blanks"; 0 means none. -->
			<div class="erow blank-row" title="Blank tiles">
				<span class="cell static c-tile">?</span>
				<span class="cell static c-num">0</span>
				<input
					class="cell c-num"
					type="number"
					bind:value={blankCount}
					min="0"
					max="10"
					{disabled}
					aria-label="Number of blank tiles"
				/>
				<span class="c-vowel"></span>
				<span class="c-x"></span>
			</div>
		</div>

		{#each tiles as tile, i (i)}
			<div class="erow">
				<input
					class="cell glyph c-tile"
					type="text"
					bind:value={tile.glyph}
					maxlength="4"
					spellcheck="false"
					autocapitalize="characters"
					{disabled}
					aria-label="Tile {i + 1} letters"
				/>
				<input
					class="cell c-num"
					type="number"
					bind:value={tile.value}
					min="0"
					{disabled}
					aria-label="Tile {i + 1} points"
				/>
				<input
					class="cell c-num"
					type="number"
					bind:value={tile.frequency}
					min="0"
					{disabled}
					aria-label="Tile {i + 1} bag count, 0 = blank-only"
				/>
				<span class="c-vowel">
					<input
						type="checkbox"
						bind:checked={tile.vowel}
						{disabled}
						aria-label="Tile {i + 1} is a vowel"
					/>
				</span>
				<button
					type="button"
					class="x c-x"
					onclick={() => removeTile(i)}
					{disabled}
					aria-label="Remove tile {i + 1}"
				>
					×
				</button>
			</div>
		{/each}
	</div>

	<div class="editor-foot">
		<button type="button" class="btn btn--ghost sm" onclick={addTile} {disabled}>+ Add tile</button>
		{#if footer}
			<span class="foot-right">{@render footer()}</span>
		{/if}
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	/* No nested scroll: the table flows in the host's scroll region. */
	.table {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
	}
	/* Column labels + the fixed blanks row, set off from the editable tiles. */
	.thead {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--s2);
	}
	.erow {
		display: grid;
		grid-template-columns: minmax(4rem, 1.4fr) minmax(3rem, 1fr) minmax(3rem, 1fr) 3.5rem 2rem;
		gap: var(--s2);
		align-items: center;
	}
	.ehead {
		font-family: var(--font-word);
		font-size: 0.64rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.c-tile {
		text-align: left;
	}
	.ehead .c-num {
		text-align: center;
	}
	.c-vowel,
	.c-x {
		display: flex;
		justify-content: center;
	}

	.cell {
		width: 100%;
		background: var(--surface-1);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 0.45rem 0.55rem;
		font: inherit;
		text-align: center;
		transition: border-color var(--t-fast) var(--ease);
	}
	.cell:focus {
		border-color: var(--maple);
	}
	.cell.glyph {
		font-family: var(--font-word);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		text-align: left;
	}
	.cell.c-num {
		font-family: var(--font-word);
	}
	/* Fixed (non-editable) cells in the blanks row read as labels, not fields. */
	.cell.static {
		display: flex;
		align-items: center;
		background: transparent;
		border-color: transparent;
		color: var(--ink-dim);
		cursor: default;
	}
	.cell.static.c-num {
		justify-content: center;
	}

	.c-vowel input[type='checkbox'] {
		width: auto;
		accent-color: var(--maple);
		cursor: pointer;
	}
	.x {
		color: var(--ink-faint);
		font-size: 1.05rem;
		line-height: 1;
		padding: 0.1rem 0.3rem;
		border-radius: var(--r-sm);
	}
	.x:hover:not(:disabled) {
		color: var(--invalid);
		background: var(--invalid-wash);
	}

	.editor-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
	}
	.foot-right {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	.btn.sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}

	input:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
