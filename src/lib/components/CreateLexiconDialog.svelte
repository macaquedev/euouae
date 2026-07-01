<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import { ALPHABETS, ENGLISH } from '$lib/lexicon/alphabets';
	import { Alphabet, type AlphabetSpec } from '$lib/lexicon/alphabet';
	import { buildCustomLexicon, type CustomBuildPhase } from '$lib/lexicon/customBuild';
	import { parseSource } from '$lib/lexicon/build';
	import {
		saveCustomLexicon,
		validateName,
		type AlphabetKey,
		type AlphabetChoice
	} from '$lib/lexicon/registry';
	import Tile from './Tile.svelte';

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

	interface DraftTile {
		glyph: string;
		value: number;
		frequency: number;
		vowel: boolean;
	}

	const draftFrom = (a: Alphabet): DraftTile[] =>
		a.tiles.map((t) => ({ glyph: t.glyph, value: t.value, frequency: t.frequency, vowel: t.vowel }));

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
	let nameInput = $state<HTMLInputElement | null>(null);

	// The tile set starts as a preset shown in full below; editing any value forks it
	// into a renameable custom set ("English (customised)").
	let basePreset = $state<AlphabetKey>('ENGLISH');
	let customName = $state('');
	let blankCount = $state(ENGLISH.blankCount);
	let draftTiles = $state<DraftTile[]>(draftFrom(ENGLISH));

	// The full tile editor stays collapsed behind a compact preview until asked for.
	let editing = $state(false);
	// Whether the draft has been forked off its base preset into a custom tile set.
	let forked = $state(false);

	$effect(() => nameInput?.focus());

	// Not registered with kbd's palette/help/lexiconPicker set, so lock the
	// global "g <key>" / Ctrl+K handlers directly — otherwise they fire right
	// through this dialog whenever a button (not a text field) has focus.
	$effect(() => {
		kbd.lock();
		return () => kbd.unlock();
	});

	const preset = $derived(ALPHABETS[basePreset]);
	// What the dropdown shows: a preset by key, or "Custom" once forked.
	const selectValue = $derived<AlphabetKey | 'CUSTOM'>(forked ? 'CUSTOM' : basePreset);

	function loadPreset(key: AlphabetKey) {
		basePreset = key;
		blankCount = ALPHABETS[key].blankCount;
		draftTiles = draftFrom(ALPHABETS[key]);
		customName = '';
		forked = false;
		editing = false;
	}

	function onSelect(value: string) {
		if (value === 'CUSTOM') {
			loadPreset('ENGLISH'); // the dropdown's "Custom" always starts from English
			startCustom();
		} else {
			loadPreset(value as AlphabetKey);
		}
	}

	// Fork the current base preset into an editable custom tile set.
	function startCustom() {
		forked = true;
		editing = true;
	}

	function resetTiles() {
		loadPreset(basePreset);
	}

	const wordCount = $derived(
		text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#')).length
	);

	// Tile glyphs normalised once for comparison, validation, and building.
	const normalGlyphs = $derived(draftTiles.map((t) => t.glyph.trim().toUpperCase()));

	// The name shown/saved for a forked tile set; the placeholder is used verbatim
	// when the rename field is left blank.
	const defaultName = $derived(`${preset.name} (customised)`);
	const tilesetName = $derived(customName.trim() || defaultName);

	// Null when the tile set is usable, else the first problem to surface.
	const tilesetError = $derived.by(() => {
		if (draftTiles.length === 0) return 'Add at least one tile.';
		const seen = new Set<string>();
		for (let i = 0; i < draftTiles.length; i++) {
			const glyph = normalGlyphs[i];
			const tile = draftTiles[i];
			if (!glyph) return 'Every tile needs a letter.';
			if (seen.has(glyph)) return `Duplicate tile “${glyph}”.`;
			seen.add(glyph);
			if (!Number.isInteger(tile.value) || tile.value < 0)
				return `“${glyph}” needs a point value of 0 or more.`;
			// 0 is allowed: a tile that's valid in the lexicon but absent from the
			// physical bag, playable only by spending a blank on it.
			if (!Number.isInteger(tile.frequency) || tile.frequency < 0)
				return `“${glyph}” needs a bag count of 0 or more.`;
		}
		if (!Number.isInteger(blankCount) || blankCount < 0) return 'Blanks must be 0 or more.';
		return null;
	});

	// At-a-glance summary of the tile set, shown under its name.
	const tileCount = $derived(draftTiles.length);
	const bagCount = $derived(
		draftTiles.reduce((sum, t) => sum + (Number.isFinite(t.frequency) ? t.frequency : 0), 0) +
			(Number.isFinite(blankCount) ? blankCount : 0)
	);
	const blankLabel = $derived(blankCount === 1 ? '1 blank' : `${blankCount} blanks`);
	const summary = $derived(`${tileCount} tiles · ${bagCount} in the bag · ${blankLabel}`);
	const displayName = $derived(forked ? tilesetName : preset.name);

	// The Alphabet this dialog would build with right now — null while the tile
	// editor itself is in an invalid state (tilesetError covers that case).
	const activeAlphabet = $derived.by(() => {
		if (!forked) return preset;
		if (tilesetError !== null) return null;
		return new Alphabet({
			name: tilesetName,
			blankCount,
			tiles: draftTiles.map((t, i) => ({
				glyph: normalGlyphs[i],
				value: t.value,
				frequency: t.frequency,
				vowel: t.vowel
			}))
		});
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

	function addTile() {
		draftTiles = [...draftTiles, { glyph: '', value: 1, frequency: 1, vowel: false }];
	}

	function removeTile(index: number) {
		draftTiles = draftTiles.filter((_, i) => i !== index);
	}

	/** The Alphabet to build with, plus the choice to persist with the lexicon. */
	function resolveAlphabet(): { alphabet: Alphabet; choice: AlphabetChoice } {
		if (!forked) {
			return { alphabet: preset, choice: { kind: 'preset', key: basePreset } };
		}
		const spec: AlphabetSpec = {
			name: tilesetName,
			blankCount,
			tiles: draftTiles.map((t, i) => ({
				glyph: normalGlyphs[i],
				value: t.value,
				frequency: t.frequency,
				vowel: t.vowel
			}))
		};
		return { alphabet: new Alphabet(spec), choice: { kind: 'custom', spec } };
	}

	// Generous but finite: a full Collins word list is a few MB of text; this
	// stops a wrong/huge file pick from hanging the tab reading it in.
	const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

	async function onFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > MAX_IMPORT_BYTES) {
			error = `${file.name} is ${Math.round(file.size / (1024 * 1024))} MB — over the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB limit for a word list.`;
			input.value = '';
			return;
		}
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
						{#each presetOptions as opt (opt.key)}
							<option value={opt.key}>{opt.label}</option>
						{/each}
						<option value="CUSTOM">Custom…</option>
					</select>
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
						{#if !editing}
							<button type="button" class="btn btn--ghost sm" onclick={startCustom} disabled={building}>
								{forked ? 'Edit tiles' : 'Customise'}
							</button>
						{/if}
					</div>

					{#if editing}
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
											disabled={building}
											aria-label="Number of blank tiles"
										/>
										<span class="c-vowel"></span>
										<span class="c-x"></span>
									</div>
								</div>

								{#each draftTiles as tile, i (i)}
									<div class="erow">
										<input
											class="cell glyph c-tile"
											type="text"
											bind:value={tile.glyph}
											maxlength="4"
											spellcheck="false"
											autocapitalize="characters"
											disabled={building}
											aria-label="Tile {i + 1} letters"
										/>
										<input
											class="cell c-num"
											type="number"
											bind:value={tile.value}
											min="0"
											disabled={building}
											aria-label="Tile {i + 1} points"
										/>
										<input
											class="cell c-num"
											type="number"
											bind:value={tile.frequency}
											min="0"
											disabled={building}
											aria-label="Tile {i + 1} bag count, 0 = blank-only"
										/>
										<span class="c-vowel">
											<input
												type="checkbox"
												bind:checked={tile.vowel}
												disabled={building}
												aria-label="Tile {i + 1} is a vowel"
											/>
										</span>
										<button
											type="button"
											class="x c-x"
											onclick={() => removeTile(i)}
											disabled={building}
											aria-label="Remove tile {i + 1}"
										>
											×
										</button>
									</div>
								{/each}
							</div>

							<div class="editor-foot">
								<button type="button" class="btn btn--ghost sm" onclick={addTile} disabled={building}>
									+ Add tile
								</button>
								<span class="foot-right">
									{#if forked}
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
								</span>
							</div>
						</div>
					{:else}
						<div class="rack">
							{#each draftTiles as tile, i (i)}
								<span class="rack-cell">
									<Tile glyph={normalGlyphs[i]} value={tile.value} size="2rem" />
									<span class="rack-count">×{tile.frequency}</span>
								</span>
							{/each}
							{#if blankCount > 0}
								<span class="rack-cell">
									<Tile glyph="?" size="2rem" />
									<span class="rack-count">×{blankCount}</span>
								</span>
							{/if}
						</div>
					{/if}
				</div>

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
		background: rgba(4, 7, 5, 0.62);
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
	}
	.bag-id {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
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

	/* — Tile preview: the real maple tiles, as a rack (signature element) ——— */
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

	/* — Tile editor: a full-width distribution table ————————————————————— */
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	/* No nested scroll: the table flows in the modal body, which is the sole
	   scroll region. One scroll, one mental model. */
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
