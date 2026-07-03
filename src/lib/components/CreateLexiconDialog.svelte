<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { ALPHABETS, ENGLISH } from '$lib/lexicon/alphabets';
	import { Alphabet, type AlphabetSpec } from '$lib/lexicon/alphabet';
	import {
		draftFromAlphabet,
		normalGlyph,
		validateTileSet,
		specFromDraft,
		tileSetSummary,
		parseTileSetsFile,
		type DraftTile
	} from '$lib/lexicon/tileset';
	import {
		listSavedAlphabets,
		saveAlphabet,
		deleteSavedAlphabet,
		validateAlphabetName,
		type SavedAlphabet
	} from '$lib/lexicon/savedAlphabets';
	import { buildCustomLexicon, type CustomBuildPhase } from '$lib/lexicon/customBuild';
	import { parseSource } from '$lib/lexicon/build';
	import {
		saveCustomLexicon,
		validateName,
		type AlphabetKey,
		type AlphabetChoice
	} from '$lib/lexicon/registry';
	import TileRack from './TileRack.svelte';
	import TileSetEditor from './TileSetEditor.svelte';

	interface Props {
		oncreated: (name: string) => void;
		oncancel: () => void;
	}

	let { oncreated, oncancel }: Props = $props();

	const dur = overlayDuration();

	const presetOptions = (Object.keys(ALPHABETS) as AlphabetKey[]).map((key) => ({
		key,
		label: ALPHABETS[key].name
	}));

	const draftFromSpec = (spec: AlphabetSpec): DraftTile[] =>
		spec.tiles.map((t) => ({ glyph: t.glyph, value: t.value, frequency: t.frequency, vowel: t.vowel }));

	let name = $state('');
	let text = $state('');
	let fileName = $state<string | null>(null);
	let building = $state(false);
	let buildProgress = $state<{ phase: CustomBuildPhase; done: number; total: number } | null>(null);
	let buildController: AbortController | null = null;
	let error = $state<string | null>(null);

	const BUILD_PHASE_LABEL: Record<CustomBuildPhase, string> = {
		parsing: 'Parsing word list',
		deriving: 'Deriving columns',
		ranking: 'Ranking by probability',
		rows: 'Building rows',
		writing: 'Writing database'
	};
	const buildPct = $derived(
		buildProgress && buildProgress.total > 0
			? Math.round((buildProgress.done / buildProgress.total) * 100)
			: 0
	);
	let fileInput = $state<HTMLInputElement | null>(null);
	let tilesFileInput = $state<HTMLInputElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	// — Tile set selection ——————————————————————————————————————————————————
	// The bag starts as a preset shown in full below. Editing it, picking one of
	// the user's saved tile sets, or importing a file forks it into an editable
	// custom set that can be saved back to the library.
	let savedSets = $state<SavedAlphabet[]>([]);
	let basePreset = $state<AlphabetKey>('ENGLISH');
	/** The saved tile set the draft came from, if any — Save then updates it. */
	let savedOrigin = $state<string | null>(null);
	let customName = $state('');
	let blankCount = $state(ENGLISH.blankCount);
	let draftTiles = $state<DraftTile[]>(draftFromAlphabet(ENGLISH));

	// The full tile editor stays collapsed behind a compact preview until asked for.
	let editing = $state(false);
	// Whether the draft has forked off its base preset into a custom tile set.
	let forked = $state(false);
	// Transient result of a "Save to library" or "Import" action.
	let saveNote = $state<{ ok: boolean; text: string } | null>(null);
	// Inline confirm for deleting the selected saved tile set from the library.
	let confirmDeleteSet = $state(false);

	$effect(() => nameInput?.focus());

	// Not registered with kbd's palette/help/lexiconPicker set, so lock the
	// global "g <key>" / Ctrl+K handlers directly — otherwise they fire right
	// through this dialog whenever a button (not a text field) has focus.
	$effect(() => {
		kbd.lock();
		return () => kbd.unlock();
	});

	$effect(() => {
		void refreshSaved();
	});

	async function refreshSaved() {
		savedSets = await listSavedAlphabets().catch(() => []);
	}

	const preset = $derived(ALPHABETS[basePreset]);
	// What the dropdown shows: a preset by key, a saved set, or "Custom" once forked.
	const selectValue = $derived<string>(
		forked ? (savedOrigin ? `saved:${savedOrigin}` : 'CUSTOM') : basePreset
	);

	function loadPreset(key: AlphabetKey) {
		basePreset = key;
		blankCount = ALPHABETS[key].blankCount;
		draftTiles = draftFromAlphabet(ALPHABETS[key]);
		customName = '';
		forked = false;
		editing = false;
		savedOrigin = null;
		saveNote = null;
		confirmDeleteSet = false;
	}

	function loadSaved(setName: string) {
		const set = savedSets.find((s) => s.name === setName);
		if (!set) return;
		blankCount = set.spec.blankCount;
		draftTiles = draftFromSpec(set.spec);
		customName = set.name;
		forked = true;
		editing = false;
		savedOrigin = set.name;
		saveNote = null;
		confirmDeleteSet = false;
	}

	function onSelect(value: string) {
		if (value === 'CUSTOM') {
			loadPreset('ENGLISH'); // the dropdown's "Custom" always starts from English
			startCustom();
		} else if (value.startsWith('saved:')) {
			loadSaved(value.slice('saved:'.length));
		} else {
			loadPreset(value as AlphabetKey);
		}
	}

	// Fork the current base preset into an editable custom tile set.
	function startCustom() {
		forked = true;
		editing = true;
		savedOrigin = null;
		saveNote = null;
	}

	// "Customise" a preset forks it; "Edit tiles" just reopens an existing fork.
	function startEdit() {
		if (forked) editing = true;
		else startCustom();
	}

	function resetTiles() {
		if (savedOrigin) loadSaved(savedOrigin);
		else loadPreset(basePreset);
	}

	const wordCount = $derived(
		text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).length
	);

	// Tile glyphs normalised once for the preview, validation, and building.
	const normalGlyphs = $derived(draftTiles.map((t) => normalGlyph(t.glyph)));

	// The name shown/saved for a forked tile set; the placeholder is used verbatim
	// when the rename field is left blank.
	const defaultName = $derived(`${preset.name} (customised)`);
	const tilesetName = $derived(customName.trim() || defaultName);

	// Null when the tile set is usable, else the first problem to surface.
	const tilesetError = $derived(validateTileSet(draftTiles, blankCount));

	// At-a-glance summary + rack preview of the tile set.
	const summary = $derived(tileSetSummary(draftTiles, blankCount));
	const displayName = $derived(forked ? tilesetName : preset.name);
	const rackTiles = $derived(
		draftTiles.map((t, i) => ({ glyph: normalGlyphs[i], value: t.value, frequency: t.frequency }))
	);

	// The Alphabet this dialog would build with right now — null while the tile
	// editor itself is in an invalid state (tilesetError covers that case).
	const activeAlphabet = $derived.by(() => {
		if (!forked) return preset;
		if (tilesetError !== null) return null;
		return new Alphabet(specFromDraft(tilesetName, draftTiles, blankCount));
	});

	// The first word that uses a character outside the active tile set, if any —
	// e.g. an English word list ("AAK") against a Spanish tile set with no K.
	// Surfaced live so the word list (or the tile set) gets fixed before
	// building, rather than that word silently being dropped at build time.
	const firstInvalidWord = $derived.by(() => {
		if (!activeAlphabet) return null;
		for (const entry of parseSource(text)) {
			if (!activeAlphabet.tokenizeStrict(entry.word)) return entry.word;
		}
		return null;
	});

	const ready = $derived(
		name.trim() !== '' &&
			wordCount > 0 &&
			!building &&
			tilesetError === null &&
			firstInvalidWord === null
	);

	// A forked, valid tile set can be saved to the reusable library.
	const canSave = $derived(forked && tilesetError === null);

	/** The Alphabet to build with, plus the choice to persist with the lexicon. */
	function resolveAlphabet(): { alphabet: Alphabet; choice: AlphabetChoice } {
		if (!forked) {
			return { alphabet: preset, choice: { kind: 'preset', key: basePreset } };
		}
		const spec = specFromDraft(tilesetName, draftTiles, blankCount);
		return { alphabet: new Alphabet(spec), choice: { kind: 'custom', spec } };
	}

	async function saveToLibrary() {
		if (!canSave) return;
		saveNote = null;
		const spec = specFromDraft(tilesetName, draftTiles, blankCount);
		const others = savedSets.map((s) => s.name).filter((n) => n !== savedOrigin);
		const nameError = validateAlphabetName(spec.name, others);
		if (nameError) {
			saveNote = { ok: false, text: nameError };
			return;
		}
		try {
			await saveAlphabet(spec);
			await refreshSaved();
			savedOrigin = spec.name;
			customName = spec.name;
			saveNote = { ok: true, text: `Saved “${spec.name}” to your tile sets.` };
		} catch (err) {
			saveNote = { ok: false, text: err instanceof Error ? err.message : String(err) };
		}
	}

	// Remove the selected saved tile set from the library. Its tiles stay loaded as
	// an unsaved custom bag so an in-progress build isn't disrupted.
	async function deleteSavedSet() {
		const name = savedOrigin;
		confirmDeleteSet = false;
		if (!name) return;
		try {
			await deleteSavedAlphabet(name);
			await refreshSaved();
			savedOrigin = null;
			forked = true;
			saveNote = { ok: true, text: `Deleted “${name}” from your tile sets.` };
		} catch (err) {
			saveNote = { ok: false, text: err instanceof Error ? err.message : String(err) };
		}
	}

	async function onTilesFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		saveNote = null;
		try {
			const specs = parseTileSetsFile(await file.text());
			const spec = specs[0];
			blankCount = spec.blankCount;
			draftTiles = draftFromSpec(spec);
			customName = spec.name;
			forked = true;
			editing = false;
			savedOrigin = null;
			saveNote = {
				ok: true,
				text:
					specs.length > 1
						? `Loaded “${spec.name}”. The file's other ${specs.length - 1} tile ${specs.length - 1 === 1 ? 'set was' : 'sets were'} ignored — import them from Manage tile sets.`
						: `Loaded “${spec.name}”. Save it to keep it in your library.`
			};
		} catch (err) {
			saveNote = { ok: false, text: err instanceof Error ? err.message : String(err) };
		}
	}

	async function onFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const contents = await file.text();
			fileName = file.name;
			text = contents;
			error = null;
		} catch (err) {
			error = `Couldn't read ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			input.value = '';
		}
	}

	function cancelBuild() {
		buildController?.abort();
	}

	async function build() {
		if (!ready) return;
		error = null;
		const nameError = await validateName(name);
		if (nameError) {
			error = nameError;
			return;
		}
		building = true;
		buildProgress = null;
		const controller = new AbortController();
		buildController = controller;
		// Let the "Building…" state paint before the compile takes over.
		await new Promise((r) => setTimeout(r, 0));
		try {
			const trimmed = name.trim();
			const { alphabet: tileset, choice } = resolveAlphabet();
			// firstInvalidWord already guarantees (via `ready`) that nothing here
			// gets dropped — buildRows' own filter is just a defensive backstop.
			const { bytes, wordCount: built } = await buildCustomLexicon(tileset, text, {
				onProgress: (p) => (buildProgress = p),
				signal: controller.signal
			});
			await saveCustomLexicon(trimmed, choice, bytes, built);
			oncreated(trimmed);
		} catch (err) {
			// A cancelled build returns to the editable form quietly — it's not a
			// failure, so it doesn't get the red error banner.
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				error = err instanceof Error ? err.message : String(err);
			}
			building = false;
			buildProgress = null;
		} finally {
			buildController = null;
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			if (building) cancelBuild();
			else oncancel();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" transition:fade={{ duration: dur }}>
	<button
		class="backdrop"
		tabindex="-1"
		aria-label="Cancel"
		onclick={() => !building && oncancel()}
	></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lex-title"
		use:trapFocus
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<header class="head">
			<span class="eyebrow">New lexicon</span>
			<h2 id="lex-title">Build a lexicon</h2>
			<p class="lede">
				Bring your own word list — one <code>WORD</code> per line, an optional TAB-separated
				definition after it. Alphagrams, hooks, point values and probability are worked out for you.
			</p>
		</header>

		<div class="body">
			<section class="field">
				<label class="lbl" for="lex-name">Name</label>
				<input
					id="lex-name"
					class="input"
					bind:this={nameInput}
					bind:value={name}
					placeholder="e.g. My Club List"
					autocomplete="off"
					spellcheck="false"
					disabled={building}
				/>
			</section>

			<section class="field">
				<div class="lbl-row">
					<label class="lbl" for="lex-words">Word list</label>
					{#if wordCount}
						<span class="count">{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
					{/if}
				</div>
				<textarea
					id="lex-words"
					class="input area"
					bind:value={text}
					placeholder={'AA\nAAH\tto exclaim in surprise\nAALII\ta tropical shrub\n…'}
					spellcheck="false"
					disabled={building}
				></textarea>
				<div class="area-foot">
					<input
						bind:this={fileInput}
						type="file"
						accept=".txt,.tsv,.csv,text/plain"
						onchange={onFile}
						hidden
					/>
					<button
						type="button"
						class="btn btn--ghost sm"
						onclick={() => fileInput?.click()}
						disabled={building}
					>
						Import file
					</button>
					<span class="faint">{fileName ?? 'or paste above'}</span>
				</div>
				{#if firstInvalidWord}
					<p class="note err">
						“{firstInvalidWord}” uses a letter outside the {displayName} tile set.
					</p>
				{/if}
			</section>

			<section class="field">
				<label class="lbl" for="lex-tiles">Tile set</label>
				<div class="select">
					<select
						id="lex-tiles"
						class="input"
						value={selectValue}
						onchange={(e) => onSelect(e.currentTarget.value)}
						disabled={building}
					>
						<optgroup label="Built-in">
							{#each presetOptions as opt (opt.key)}
								<option value={opt.key}>{opt.label}</option>
							{/each}
						</optgroup>
						{#if savedSets.length}
							<optgroup label="Your tile sets">
								{#each savedSets as set (set.name)}
									<option value={`saved:${set.name}`}>{set.name}</option>
								{/each}
							</optgroup>
						{/if}
						<option value="CUSTOM">Custom…</option>
					</select>
				</div>

				<div class="tiles-actions">
					<input
						bind:this={tilesFileInput}
						type="file"
						accept=".json,application/json"
						onchange={onTilesFile}
						hidden
					/>
					<button
						type="button"
						class="btn btn--ghost sm"
						onclick={() => tilesFileInput?.click()}
						disabled={building}
					>
						Import tile set…
					</button>
					<span class="faint">Bring in a shared <code>.json</code> tile set</span>
				</div>

				<div class="bag" class:custom={forked}>
					<div class="bag-head">
						<div class="bag-id">
							{#if editing && forked}
								<input
									class="bag-name"
									type="text"
									bind:value={customName}
									placeholder={defaultName}
									maxlength="40"
									spellcheck="false"
									disabled={building}
									aria-label="Tile set name"
								/>
							{:else}
								<span class="bag-name-static">{displayName}</span>
							{/if}
							<span class="bag-meta">{summary}</span>
						</div>
						<div class="bag-actions">
							{#if confirmDeleteSet}
								<span class="del-q">Remove from your library?</span>
								<button
									type="button"
									class="btn btn--ghost sm"
									onclick={deleteSavedSet}
									disabled={building}
								>
									Delete
								</button>
								<button
									type="button"
									class="btn btn--ghost sm"
									onclick={() => (confirmDeleteSet = false)}
									disabled={building}
								>
									Keep
								</button>
							{:else}
								{#if forked}
									<button
										type="button"
										class="btn btn--ghost sm"
										onclick={saveToLibrary}
										disabled={building || !canSave}
										title="Save this tile set to reuse it"
									>
										{savedOrigin ? 'Save' : 'Save to library'}
									</button>
								{/if}
								{#if savedOrigin}
									<button
										type="button"
										class="btn btn--ghost sm"
										onclick={() => (confirmDeleteSet = true)}
										disabled={building}
										title="Delete this saved tile set from your library"
									>
										Delete
									</button>
								{/if}
								{#if !editing}
									<button
										type="button"
										class="btn btn--ghost sm"
										onclick={startEdit}
										disabled={building}
									>
										{forked ? 'Edit tiles' : 'Customise'}
									</button>
								{/if}
							{/if}
						</div>
					</div>

					{#if editing}
						<TileSetEditor bind:tiles={draftTiles} bind:blankCount disabled={building}>
							{#snippet footer()}
								{#if savedOrigin}
									<button type="button" class="link" onclick={resetTiles} disabled={building}>
										Reset changes
									</button>
								{:else if forked}
									<button type="button" class="link" onclick={resetTiles} disabled={building}>
										Reset to {preset.name}
									</button>
								{/if}
								<button
									type="button"
									class="btn btn--ghost sm"
									onclick={() => (editing = false)}
									disabled={building}
								>
									Done
								</button>
							{/snippet}
						</TileSetEditor>
					{:else}
						<TileRack tiles={rackTiles} {blankCount} />
					{/if}
				</div>

				{#if saveNote}
					<p class="note" class:err={!saveNote.ok} class:ok={saveNote.ok}>{saveNote.text}</p>
				{/if}
				{#if tilesetError}
					<p class="note err">{tilesetError}</p>
				{/if}
			</section>
		</div>

		<footer class="foot">
			{#if error}<p class="note err strong" role="alert">{error}</p>{/if}
			{#if building}
				<div class="build-progress">
					<div class="build-progress-track">
						<div class="build-progress-fill" style:width="{buildPct}%"></div>
					</div>
					<span class="build-progress-label">
						{buildProgress ? BUILD_PHASE_LABEL[buildProgress.phase] : 'Starting…'}
						{#if buildProgress}
							· {buildProgress.done.toLocaleString()} / {buildProgress.total.toLocaleString()}
						{/if}
					</span>
				</div>
			{/if}
			<div class="foot-actions">
				<button type="button" class="btn btn--ghost" onclick={() => (building ? cancelBuild() : oncancel())}>
					{building ? 'Cancel build' : 'Cancel'}
				</button>
				<button type="button" class="btn btn--primary" onclick={build} disabled={!ready}>
					{building ? 'Building…' : 'Build lexicon'}
				</button>
			</div>
		</footer>
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
		width: min(94vw, 34rem);
		max-height: 88vh;
		overflow: hidden;
		background: var(--surface-1);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		display: flex;
		flex-direction: column;
	}

	/* — Header (pinned above the scroll) ——————————————————————————————— */
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
	.lede {
		margin: 0;
		max-width: 42ch;
		color: var(--ink-dim);
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.lede code {
		font-family: var(--font-word);
		font-size: 0.85em;
		color: var(--maple-soft);
		background: var(--surface-2);
		padding: 0.05rem 0.3rem;
		border-radius: var(--r-sm);
	}

	/* — Fields (Gestalt: proximity — label, control, status as one cluster) —— */
	/* The one and only scroll region: header and footer stay put, this scrolls.
	   A stable gutter keeps the scrollbar off the tile editor's × column. */
	.body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
		display: flex;
		flex-direction: column;
		gap: var(--s5);
		padding: 0 var(--s5) var(--s5);
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
	.count {
		font-family: var(--font-word);
		font-size: 0.78rem;
		color: var(--maple);
	}

	.area {
		min-height: 6.5rem;
		resize: vertical;
		font-family: var(--font-word);
		font-size: 0.85rem;
		line-height: 1.55;
		white-space: pre;
	}
	.area::placeholder {
		color: var(--ink-faint);
	}
	.area-foot {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}

	.btn.sm {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}

	/* Native <select> dressed as a field with our own chevron. */
	.select {
		position: relative;
	}
	.select select {
		appearance: none;
		padding-right: 2.3rem;
		cursor: pointer;
	}
	.select::after {
		content: '';
		position: absolute;
		top: 50%;
		right: 0.95rem;
		width: 0.5rem;
		height: 0.5rem;
		border-right: 2px solid var(--ink-dim);
		border-bottom: 2px solid var(--ink-dim);
		transform: translateY(-65%) rotate(45deg);
		pointer-events: none;
	}

	.tiles-actions {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	.tiles-actions code {
		font-family: var(--font-word);
		font-size: 0.85em;
	}

	/* — The bag: a bounded region for the tile set (Gestalt: common region) —— */
	.bag {
		margin-top: var(--s1);
		display: flex;
		flex-direction: column;
		gap: var(--s3);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: var(--s3) var(--s4);
	}
	/* A forked set is accented so it reads as "yours" now. */
	.bag.custom {
		border-color: var(--maple-deep);
		box-shadow: inset 0 0 0 1px var(--maple-ghost);
	}
	.bag-head {
		display: flex;
		align-items: center;
		gap: var(--s3);
		flex-wrap: wrap;
	}
	.bag-id {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}
	.bag-actions {
		display: flex;
		align-items: center;
		gap: var(--s2);
		flex-shrink: 0;
	}
	.del-q {
		font-size: 0.8rem;
		color: var(--invalid);
	}
	.bag-name-static {
		font-weight: 600;
		font-size: 1rem;
		color: var(--ink);
	}
	/* The rename field reads as an editable title, not a form box. */
	.bag-name {
		width: 100%;
		max-width: 20rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--line-strong);
		border-radius: 0;
		padding: 0.1rem 0;
	}
	.bag-name:focus {
		border-bottom-color: var(--maple);
	}
	.bag-name::placeholder {
		color: var(--ink-faint);
		font-weight: 600;
	}
	.bag-meta {
		font-family: var(--font-word);
		font-size: 0.74rem;
		color: var(--ink-faint);
	}

	.link {
		color: var(--maple);
		font-size: 0.82rem;
		padding: 0;
	}
	.link:hover:not(:disabled) {
		text-decoration: underline;
	}

	/* — Inline notes (Nielsen: error prevention + recovery) ————————————— */
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
	.note.err.strong {
		background: var(--invalid-wash);
		border: 1px solid var(--invalid);
		border-radius: var(--r-sm);
		padding: 0.55rem 0.7rem;
	}

	/* — Footer actions (pinned below the scroll) ——————————————————————— */
	.foot {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s3);
		padding: var(--s4) var(--s5) var(--s5);
		border-top: 1px solid var(--line);
	}
	.foot-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--s2);
	}

	.build-progress {
		display: flex;
		align-items: center;
		gap: var(--s3);
	}
	.build-progress-track {
		flex: 1;
		height: 6px;
		background: var(--surface-2);
		border-radius: var(--r-pill);
		overflow: hidden;
	}
	.build-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--maple-deep), var(--maple));
		border-radius: var(--r-pill);
		transition: width var(--t) var(--ease);
	}
	.build-progress-label {
		flex-shrink: 0;
		font-family: var(--font-word);
		font-size: 0.8rem;
		color: var(--ink-dim);
		white-space: nowrap;
	}

	input:disabled,
	select:disabled,
	textarea:disabled {
		opacity: 0.6;
		cursor: default;
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
