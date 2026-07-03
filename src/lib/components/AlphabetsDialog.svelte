<script lang="ts">
	// The tile-set library manager: view, create, edit, rename, delete, import and
	// export the saved tile sets ("alphabets"). Reached from the command palette;
	// the lexicon builder writes to the same library when you save a bag there.
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { saveTextFile } from '$lib/platform/download';
	import { ENGLISH } from '$lib/lexicon/alphabets';
	import {
		draftFromAlphabet,
		validateTileSet,
		specFromDraft,
		tileSetSummary,
		serializeTileSets,
		parseTileSetsFile,
		TILESET_EXTENSION,
		type DraftTile
	} from '$lib/lexicon/tileset';
	import type { AlphabetSpec } from '$lib/lexicon/alphabet';
	import {
		listSavedAlphabets,
		saveAlphabet,
		deleteSavedAlphabet,
		renameSavedAlphabet,
		validateAlphabetName,
		type SavedAlphabet
	} from '$lib/lexicon/savedAlphabets';
	import TileRack from './TileRack.svelte';
	import TileSetEditor from './TileSetEditor.svelte';

	const dur = overlayDuration();
	const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
	const slug = (name: string) => name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'tile-set';
	const jsonFilter = { name: 'Tile set', extensions: [TILESET_EXTENSION] };

	let view = $state<'list' | 'edit'>('list');
	let sets = $state<SavedAlphabet[]>([]);
	let note = $state<{ ok: boolean; text: string } | null>(null);
	let error = $state<string | null>(null);
	let pendingDelete = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Edit buffer — editOriginal is the name being edited, or null for a new set.
	let editOriginal = $state<string | null>(null);
	let draftName = $state('');
	let draftTiles = $state<DraftTile[]>([]);
	let draftBlank = $state(2);

	$effect(() => {
		void refresh();
	});

	async function refresh() {
		sets = await listSavedAlphabets().catch(() => []);
	}

	const rackOf = (spec: AlphabetSpec) =>
		spec.tiles.map((t) => ({ glyph: t.glyph, value: t.value, frequency: t.frequency }));

	const editReady = $derived(
		draftName.trim() !== '' && validateTileSet(draftTiles, draftBlank) === null
	);

	function newSet() {
		error = null;
		note = null;
		editOriginal = null;
		draftName = '';
		draftTiles = draftFromAlphabet(ENGLISH); // a sensible starting bag to trim
		draftBlank = ENGLISH.blankCount;
		view = 'edit';
	}

	function editSet(set: SavedAlphabet) {
		error = null;
		note = null;
		editOriginal = set.name;
		draftName = set.name;
		draftTiles = set.spec.tiles.map((t) => ({
			glyph: t.glyph,
			value: t.value,
			frequency: t.frequency,
			vowel: t.vowel
		}));
		draftBlank = set.spec.blankCount;
		view = 'edit';
	}

	async function saveEdit() {
		error = null;
		const tileError = validateTileSet(draftTiles, draftBlank);
		if (tileError) {
			error = tileError;
			return;
		}
		const newName = draftName.trim();
		const others = sets.map((s) => s.name).filter((n) => n !== editOriginal);
		const nameError = validateAlphabetName(newName, others);
		if (nameError) {
			error = nameError;
			return;
		}
		const spec = specFromDraft(newName, draftTiles, draftBlank);
		try {
			// Rename first so the entry keeps its place and creation time, then the
			// upsert-by-name writes the edited tiles into it.
			if (editOriginal && editOriginal !== newName) {
				await renameSavedAlphabet(editOriginal, newName);
			}
			await saveAlphabet(spec);
			await refresh();
			note = { ok: true, text: `Saved “${newName}”.` };
			view = 'list';
		} catch (err) {
			error = msg(err);
		}
	}

	async function doDelete(name: string) {
		pendingDelete = null;
		try {
			await deleteSavedAlphabet(name);
			await refresh();
			note = { ok: true, text: `Deleted “${name}”.` };
		} catch (err) {
			error = msg(err);
		}
	}

	async function exportSpec(spec: AlphabetSpec) {
		error = null;
		note = null;
		try {
			await saveTextFile(`${slug(spec.name)}.${TILESET_EXTENSION}`, serializeTileSets([spec]), jsonFilter);
			note = { ok: true, text: `Exported “${spec.name}”.` };
		} catch (err) {
			error = msg(err);
		}
	}

	async function exportAll() {
		error = null;
		note = null;
		try {
			await saveTextFile(
				`euouae-tile-sets.${TILESET_EXTENSION}`,
				serializeTileSets(sets.map((s) => s.spec)),
				jsonFilter
			);
			note = { ok: true, text: `Exported ${sets.length} tile set${sets.length === 1 ? '' : 's'}.` };
		} catch (err) {
			error = msg(err);
		}
	}

	async function onImportFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		error = null;
		note = null;
		let specs: AlphabetSpec[];
		try {
			specs = parseTileSetsFile(await file.text());
		} catch (err) {
			error = msg(err);
			return;
		}
		const existing = sets.map((s) => s.name);
		const added: string[] = [];
		for (const spec of specs) {
			const finalName = uniqueName(spec.name, existing);
			if (!finalName) continue; // couldn't make it fit the naming rules
			await saveAlphabet({ ...spec, name: finalName });
			existing.push(finalName);
			added.push(finalName);
		}
		await refresh();
		note = added.length
			? { ok: true, text: `Imported ${added.length} tile set${added.length === 1 ? '' : 's'}.` }
			: { ok: false, text: 'Nothing new to import from that file.' };
	}

	/** A name for an imported set that passes the library's rules, suffixing
	 *  "(2)", "(3)"… on a clash; null if no acceptable name could be found. */
	function uniqueName(base: string, existing: string[]): string | null {
		if (!validateAlphabetName(base, existing)) return base;
		const stem = base.slice(0, 34).trim() || 'Tile set';
		for (let n = 2; n < 1000; n++) {
			const candidate = `${stem} (${n})`;
			if (!validateAlphabetName(candidate, existing)) return candidate;
		}
		return null;
	}

	function onKeydownCapture(event: KeyboardEvent) {
		// In the editor, Escape steps back to the list rather than closing the whole
		// manager. Run in the capture phase so it beats the layout's global handler.
		if (event.key === 'Escape' && view === 'edit') {
			event.preventDefault();
			event.stopPropagation();
			view = 'list';
		}
	}
</script>

<svelte:window onkeydowncapture={onKeydownCapture} />

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" tabindex="-1" aria-label="Close" onclick={() => kbd.close()}></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label="Tile sets"
		use:trapFocus
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		{#if view === 'list'}
			<header class="head">
				<span class="eyebrow">Library</span>
				<h2>Tile sets</h2>
				<p class="lede">
					Reusable letter bags — glyphs, point values, bag counts and vowels — you can build
					lexicons from, share as files, or carry in a progress backup.
				</p>
			</header>

			<div class="body">
				<div class="toolbar">
					<button type="button" class="btn btn--primary sm" onclick={newSet}>New tile set</button>
					<button type="button" class="btn btn--ghost sm" onclick={() => fileInput?.click()}>
						Import…
					</button>
					{#if sets.length}
						<button type="button" class="btn btn--ghost sm" onclick={exportAll}>Export all</button>
					{/if}
					<input
						bind:this={fileInput}
						type="file"
						accept=".json,application/json"
						onchange={onImportFile}
						hidden
					/>
				</div>

				{#if note}
					<p class="note" class:ok={note.ok} class:err={!note.ok}>{note.text}</p>
				{/if}
				{#if error}
					<p class="note err" role="alert">{error}</p>
				{/if}

				{#if sets.length === 0}
					<p class="empty">
						No saved tile sets yet. Create one here, customise a bag while building a lexicon, or
						import a shared file.
					</p>
				{:else}
					<ul class="sets">
						{#each sets as set (set.name)}
							<li class="set">
								<div class="set-head">
									<div class="set-id">
										<span class="set-name">{set.name}</span>
										<span class="set-meta">{tileSetSummary(set.spec.tiles, set.spec.blankCount)}</span>
									</div>
									<div class="set-actions">
										{#if pendingDelete === set.name}
											<span class="del-q">Delete?</span>
											<button type="button" class="btn btn--danger sm" onclick={() => doDelete(set.name)}>
												Delete
											</button>
											<button type="button" class="btn btn--ghost sm" onclick={() => (pendingDelete = null)}>
												Keep
											</button>
										{:else}
											<button type="button" class="btn btn--ghost sm" onclick={() => editSet(set)}>
												Edit
											</button>
											<button type="button" class="btn btn--ghost sm" onclick={() => exportSpec(set.spec)}>
												Export
											</button>
											<button
												type="button"
												class="trash"
												title={`Delete ${set.name}`}
												aria-label={`Delete ${set.name}`}
												onclick={() => (pendingDelete = set.name)}
											>
												✕
											</button>
										{/if}
									</div>
								</div>
								<TileRack tiles={rackOf(set.spec)} blankCount={set.spec.blankCount} size="1.8rem" />
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<footer class="foot">
				<button type="button" class="btn btn--ghost" onclick={() => kbd.close()}>Close</button>
			</footer>
		{:else}
			<header class="head">
				<span class="eyebrow">Library</span>
				<h2>{editOriginal ? 'Edit tile set' : 'New tile set'}</h2>
			</header>

			<div class="body">
				<section class="field">
					<label class="lbl" for="ts-name">Name</label>
					<input
						id="ts-name"
						class="input"
						bind:value={draftName}
						placeholder="e.g. My Club Bag"
						maxlength="40"
						autocomplete="off"
						spellcheck="false"
					/>
				</section>

				<section class="field">
					<div class="lbl-row">
						<span class="lbl">Tiles</span>
						<span class="summary">{tileSetSummary(draftTiles, draftBlank)}</span>
					</div>
					<TileSetEditor bind:tiles={draftTiles} bind:blankCount={draftBlank} />
				</section>

				{#if error}
					<p class="note err" role="alert">{error}</p>
				{/if}
			</div>

			<footer class="foot">
				<button type="button" class="btn btn--ghost" onclick={() => (view = 'list')}>Cancel</button>
				<button type="button" class="btn btn--primary" onclick={saveEdit} disabled={!editReady}>
					Save tile set
				</button>
			</footer>
		{/if}
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
		padding: 8vh var(--s4) var(--s4);
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: var(--scrim);
		backdrop-filter: blur(3px);
		cursor: default;
	}
	.modal {
		position: relative;
		width: min(94vw, 36rem);
		max-height: 88vh;
		overflow: hidden;
		background: var(--surface-1);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		display: flex;
		flex-direction: column;
	}

	.head {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s5) var(--s5) var(--s4);
	}
	.head h2 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.eyebrow {
		font-family: var(--font-word);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--maple);
	}
	.lede {
		margin: 0;
		max-width: 46ch;
		color: var(--ink-dim);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
		display: flex;
		flex-direction: column;
		gap: var(--s4);
		padding: 0 var(--s5) var(--s5);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	.btn.sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}

	.empty {
		margin: 0;
		padding: var(--s5) var(--s4);
		text-align: center;
		color: var(--ink-faint);
		font-size: 0.9rem;
		line-height: 1.5;
		background: var(--surface-2);
		border: 1px dashed var(--line-strong);
		border-radius: var(--r);
	}

	.sets {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.set {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: var(--s3) var(--s4);
	}
	.set-head {
		display: flex;
		align-items: flex-start;
		gap: var(--s3);
	}
	.set-id {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}
	.set-name {
		font-weight: 600;
		font-size: 1rem;
		color: var(--ink);
	}
	.set-meta {
		font-family: var(--font-word);
		font-size: 0.74rem;
		color: var(--ink-faint);
	}
	.set-actions {
		display: flex;
		align-items: center;
		gap: var(--s2);
		flex-shrink: 0;
	}
	.del-q {
		font-size: 0.82rem;
		color: var(--invalid);
	}
	.trash {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		padding: 0.3rem 0.5rem;
		border-radius: var(--r-sm);
		font-size: 0.85rem;
	}
	.trash:hover {
		color: var(--invalid);
		background: var(--invalid-wash);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.lbl {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink-dim);
	}
	.lbl-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s3);
	}
	.summary {
		font-family: var(--font-word);
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	.note {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.note.err {
		color: var(--invalid);
	}
	.note.ok {
		color: var(--valid);
	}

	.foot {
		flex-shrink: 0;
		display: flex;
		justify-content: flex-end;
		gap: var(--s2);
		padding: var(--s4) var(--s5) var(--s5);
		border-top: 1px solid var(--line);
	}

	@media (max-width: 460px) {
		.head {
			padding: var(--s4) var(--s4) var(--s3);
		}
		.body {
			padding: 0 var(--s4) var(--s4);
		}
		.foot {
			padding: var(--s3) var(--s4) var(--s4);
		}
	}
</style>
