<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import type { RangeField, SortColumn, StringField } from '$lib/lexicon';
	import {
		RANGE_CONDITIONS,
		STRING_CONDITIONS,
		defaultCondition,
		metaFor
	} from '$lib/search/conditions';
	import { searchState } from '$lib/search/store.svelte';
	import { setScratch } from '$lib/marinate/scratch';
	import { plural } from '$lib/text';
	import { ListStore, type ListSummary } from '$lib/userdata/lists';
	import VirtualList from '$lib/components/VirtualList.svelte';
	import WordRow from '$lib/components/WordRow.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';

	const ROW_HEIGHT = 38;
	// Hook columns are capped at this width (in ch) so one word with an unusually
	// large hook set can't blow the table out past the viewport; past the cap,
	// that row's hooks wrap onto extra lines instead (see `rowHeight` below) —
	// other rows stay single-line, since VirtualList sizes each row separately.
	const MAX_HOOK_COL = 8;
	// Extra row height (px) per wrapped hooks line beyond the first. Matches
	// `.hooks`' line-height in WordRow.svelte.
	const HOOK_LINE_HEIGHT = 17;

	// The result table's columns. Sortable ones become clickable headers; the
	// default direction is what a fresh click on that column applies.
	const COLUMNS: { key?: SortColumn; label: string; defaultDir?: 'asc' | 'desc'; class: string }[] = [
		{ label: '', class: 'c-fronthooks' },
		{ key: 'word', label: 'Word', defaultDir: 'asc', class: 'c-word' },
		{ label: '', class: 'c-backhooks' },
		{ label: 'Definition', class: 'c-def' },
		{ key: 'length', label: 'Len', defaultDir: 'asc', class: 'c-num' },
		{ key: 'pointValue', label: 'Pts', defaultDir: 'desc', class: 'c-num' },
		{ key: 'probability', label: 'Prob', defaultDir: 'asc', class: 'c-num' }
	];

	// Inputs and results read from the module store, so they persist across
	// navigation; the write-back happens through searchState in the handlers below.
	const conditions = $derived(searchState.conditions);
	const sort = $derived(searchState.sort);
	const result = $derived(searchState.result);
	const searched = $derived(searchState.searched);
	let saved = $state<string | null>(null);
	let removed = $state<string | null>(null);

	// Discard a result left over from a different lexicon (e.g. switched via the
	// command palette) so we never render rows from the wrong word list.
	$effect(() => searchState.forLexicon(lexicon.name));

	// A human-readable summary of the active conditions, used to name an ad-hoc
	// Marinate session started straight from these results.
	const summary = $derived.by(() => {
		const parts = conditions
			.map((c) => {
				const meta = metaFor(c.type);
				if (c.kind === 'string') return c.value.trim() ? `${meta.label}: ${c.value.trim()}` : '';
				return `${meta.label} ${c.min}–${c.max}`;
			})
			.filter(Boolean);
		return parts.length ? parts.join(', ') : 'Search results';
	});

	// "Save to list" / "Remove from list" share one inline panel. Save can target
	// a new named list or append into an existing one (chosen by id), mirroring the
	// Lists page so we never silently spawn a duplicate same-named deck; remove only
	// targets existing lists.
	let panel = $state<'save' | 'remove' | null>(null);
	let saveLists = $state<ListSummary[]>([]);
	let saveTarget = $state<'new' | number>('new');
	let saveName = $state('');
	const saveTargetName = $derived(
		typeof saveTarget === 'number' ? saveLists.find((l) => l.id === saveTarget)?.name : undefined
	);

	// A pending add/remove awaiting confirmation. Set by the panel buttons, run or
	// dismissed by the ConfirmModal.
	let confirmAction = $state<{
		title: string;
		message: string;
		confirmLabel: string;
		danger?: boolean;
		run: () => void;
	} | null>(null);

	function addCondition() {
		searchState.conditions = [...conditions, defaultCondition(metaFor('pattern'))];
	}

	function removeCondition(index: number) {
		searchState.conditions = conditions.filter((_, i) => i !== index);
	}

	function changeType(index: number, type: RangeField | StringField) {
		searchState.conditions[index] = defaultCondition(metaFor(type));
	}

	function run() {
		if (!lexicon.engine) return;
		// No limit — the full result set is rendered through a virtual list.
		searchState.result = lexicon.engine.search({ conditions, sort });
		searchState.searched = true;
		searchState.lexicon = lexicon.name;
		saved = null;
		removed = null;
		panel = null;
	}

	// Marinate the current result set without saving it to a list: hand the words
	// to the scratch source and open Marinate, whose Back link returns here.
	function marinate() {
		if (!result || result.words.length === 0) return;
		setScratch({ name: summary, words: [...result.words.words] });
		goto(`${base}/marinate?from=search`);
	}

	// Size the variable columns to the widest content in this result set, so the
	// word always starts at the same x and hooks are shown in full. Word gains a
	// little for its letter-spacing; the rest are clamped to a sensible minimum.
	// Hook columns are additionally capped at MAX_HOOK_COL — a word with an
	// unusually large hook set wraps onto more lines (see `rowHeight`) rather than
	// widening the whole table.
	const cols = $derived.by(() => {
		const c = result?.columns;
		const front = Math.min(Math.max(c?.frontHooks ?? 0, 2), MAX_HOOK_COL);
		const word = Math.max(c?.word ?? 0, 4);
		const back = Math.min(Math.max(c?.backHooks ?? 0, 2), MAX_HOOK_COL);
		return `${front}ch ${word + 1}ch ${back}ch minmax(8ch, 1fr) 4ch 4ch 6ch`;
	});

	// Per-row height: most words need only one line of hooks, so most rows stay
	// ROW_HEIGHT. Only a row whose own hooks exceed MAX_HOOK_COL grows taller, by
	// exactly as many lines as it needs — VirtualList sizes each row separately,
	// so one heavily-hooked word doesn't stretch every other row in the table.
	function rowHeight(index: number): number {
		const chars = result?.hookChars[index] ?? 0;
		const lines = Math.max(1, Math.ceil(chars / MAX_HOOK_COL));
		return ROW_HEIGHT + (lines - 1) * HOOK_LINE_HEIGHT;
	}

	// Click a column: toggle direction if already sorting by it, else adopt that
	// column's default direction. Re-runs the search so the DB does the ordering.
	function sortBy(column: SortColumn, defaultDir: 'asc' | 'desc') {
		searchState.sort =
			sort.column === column
				? { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
				: { column, direction: defaultDir };
		run();
	}

	async function openSave() {
		if (!result || result.words.length === 0) return;
		const store = await ListStore.open();
		saveLists = store.summaries(lexicon.name);
		saveTarget = 'new';
		saveName = '';
		saved = null;
		panel = 'save';
	}

	async function openRemove() {
		if (!result || result.words.length === 0) return;
		const store = await ListStore.open();
		saveLists = store.summaries(lexicon.name);
		saveTarget = saveLists[0]?.id ?? 'new';
		removed = null;
		panel = 'remove';
	}

	function wordCount() {
		return result?.words.length ?? 0;
	}

	function requestSave() {
		if (!result) return;
		const dest =
			saveTarget === 'new'
				? saveName.trim()
					? `new list “${saveName.trim()}”`
					: null
				: saveTargetName
					? `“${saveTargetName}”`
					: null;
		if (!dest) return;
		confirmAction = {
			title: 'Add to list?',
			message: `Add ${plural(wordCount())} to ${dest}?`,
			confirmLabel: 'Add',
			run: doSave
		};
	}

	function requestRemove() {
		if (!result || typeof saveTarget !== 'number' || saveTargetName === undefined) return;
		confirmAction = {
			title: 'Remove from list?',
			message: `Remove ${plural(wordCount())} from “${saveTargetName}”?`,
			confirmLabel: 'Remove',
			danger: true,
			run: doRemove
		};
	}

	async function doSave() {
		if (!result) return;
		const words = [...result.words.words];
		const store = await ListStore.open();
		if (saveTarget === 'new') {
			const name = saveName.trim();
			if (!name) return;
			store.save(lexicon.name, name, words);
			saved = name;
		} else {
			if (saveTargetName === undefined) return;
			store.addWords(saveTarget, words);
			saved = saveTargetName;
		}
		panel = null;
	}

	async function doRemove() {
		if (!result || typeof saveTarget !== 'number' || saveTargetName === undefined) return;
		const store = await ListStore.open();
		store.removeWords(saveTarget, [...result.words.words]);
		removed = saveTargetName;
		panel = null;
	}
</script>

<section class="search">
	<form class="builder" onsubmit={(e) => (e.preventDefault(), run())}>
		{#each conditions as condition, index (index)}
			{@const meta = metaFor(condition.type)}
			<div class="row">
				<select
					value={condition.type}
					onchange={(e) => changeType(index, e.currentTarget.value as RangeField | StringField)}
				>
					<optgroup label="Letters / pattern">
						{#each STRING_CONDITIONS as c (c.type)}
							<option value={c.type}>{c.label}</option>
						{/each}
					</optgroup>
					<optgroup label="Numbers">
						{#each RANGE_CONDITIONS as c (c.type)}
							<option value={c.type}>{c.label}</option>
						{/each}
					</optgroup>
				</select>

				{#if condition.kind === 'string' && meta.kind === 'string'}
					{#if meta.negatable}
						<label class="negate">
							<input type="checkbox" bind:checked={condition.negated} /> not
						</label>
					{/if}
					<input
						class="value"
						type="text"
						bind:value={condition.value}
						placeholder={meta.placeholder}
						spellcheck="false"
						autocapitalize="characters"
						autocomplete="off"
					/>
				{:else if condition.kind === 'range' && meta.kind === 'range'}
					<div class="range">
						<input
							type="number"
							bind:value={condition.min}
							min={meta.minBound}
							max={meta.maxBound}
							aria-label="minimum"
						/>
						<span>to</span>
						<input
							type="number"
							bind:value={condition.max}
							min={meta.minBound}
							max={meta.maxBound}
							aria-label="maximum"
						/>
					</div>
				{/if}

				<button
					type="button"
					class="remove"
					onclick={() => removeCondition(index)}
					disabled={conditions.length === 1}
					aria-label="remove condition"
				>
					×
				</button>
			</div>
		{/each}

		<div class="actions">
			<button type="button" class="add" onclick={addCondition}>+ Add condition</button>
			<button type="submit" class="go" disabled={!lexicon.engine}>Search</button>
		</div>
	</form>

	{#if result}
		<div class="results">
			<div class="results-bar">
				<p class="count">{plural(result.words.length)}</p>
				{#if result.words.length > 0}
					{#if panel === 'save'}
						<div class="save-form">
							<select bind:value={saveTarget}>
								<option value="new">＋ New list…</option>
								{#each saveLists as list (list.id)}
									<option value={list.id}>{list.name}</option>
								{/each}
							</select>
							{#if saveTarget === 'new'}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="save-name"
									bind:value={saveName}
									placeholder="List name"
									maxlength="80"
									autofocus
									onkeydown={(e) => e.key === 'Enter' && requestSave()}
								/>
							{/if}
							<button
								type="button"
								class="save"
								onclick={requestSave}
								disabled={saveTarget === 'new' && !saveName.trim()}
							>
								{saveTarget === 'new' ? 'Save' : `Add to ${saveTargetName}`}
							</button>
							<button type="button" class="cancel" onclick={() => (panel = null)}>Cancel</button>
						</div>
					{:else if panel === 'remove'}
						<div class="save-form">
							{#if saveLists.length === 0}
								<span class="count">No lists yet.</span>
							{:else}
								<select bind:value={saveTarget}>
									{#each saveLists as list (list.id)}
										<option value={list.id}>{list.name}</option>
									{/each}
								</select>
								<button
									type="button"
									class="save"
									onclick={requestRemove}
									disabled={typeof saveTarget !== 'number'}
								>
									Remove from {saveTargetName}
								</button>
							{/if}
							<button type="button" class="cancel" onclick={() => (panel = null)}>Cancel</button>
						</div>
					{:else}
						<div class="result-actions">
							<button type="button" class="save" onclick={marinate}>Marinate</button>
							<button type="button" class="save" onclick={openSave}>
								{saved ? `Saved “${saved}”` : 'Save to list'}
							</button>
							<button type="button" class="save" onclick={openRemove}>
								{removed ? `Removed from “${removed}”` : 'Remove from list'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
			{#if result.words.length > 0}
				<div class="table" style="--cols: {cols}">
					<VirtualList items={result.words} itemHeight={rowHeight}>
						{#snippet header()}
							<div class="thead">
								{#each COLUMNS as col (col.label + col.class)}
									{#if col.key}
										<button
											type="button"
											class="th {col.class}"
											class:active={sort.column === col.key}
											onclick={() => sortBy(col.key!, col.defaultDir ?? 'asc')}
										>
											{col.label}
											<span class="arrow">
												{sort.column === col.key ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
											</span>
										</button>
									{:else}
										<span class="th {col.class}">{col.label}</span>
									{/if}
								{/each}
							</div>
						{/snippet}
						{#snippet item(entry)}
							<WordRow {entry} />
						{/snippet}
					</VirtualList>
				</div>
			{:else}
				<p class="count">No matches.</p>
			{/if}
		</div>
	{:else if searched}
		<p class="count">Add a condition with a value to search.</p>
	{/if}
</section>

{#if confirmAction}
	<ConfirmModal
		title={confirmAction.title}
		message={confirmAction.message}
		confirmLabel={confirmAction.confirmLabel}
		danger={confirmAction.danger}
		onconfirm={() => {
			confirmAction?.run();
			confirmAction = null;
		}}
		oncancel={() => (confirmAction = null)}
	/>
{/if}

<style>
	.search {
		max-width: min(96vw, 82rem);
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	/* The builder stays comfortably narrow; the results table uses the full width
	   so wide hook columns have room. */
	.builder {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		outline: none;
		max-width: 52rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	select,
	input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		padding: 0.5rem 0.6rem;
		font: inherit;
		outline: none;
	}
	select:focus,
	input:focus {
		border-color: var(--accent);
	}

	.row > select {
		flex: 0 0 12rem;
	}

	.value {
		flex: 1;
		font-family: var(--font-word);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.range {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--muted);
	}
	.range input {
		width: 5rem;
		font-family: var(--font-word);
	}

	.negate {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--muted);
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.remove {
		flex: 0 0 auto;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		color: var(--muted);
		width: 2rem;
		height: 2rem;
		font-size: 1.1rem;
		line-height: 1;
	}
	.remove:hover:not(:disabled) {
		border-color: var(--invalid);
		color: var(--invalid);
	}
	.remove:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.add {
		background: transparent;
		border: 1px dashed var(--border);
		border-radius: 0.45rem;
		color: var(--muted);
		padding: 0.5rem 0.8rem;
	}
	.add:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	.go {
		margin-left: auto;
		background: var(--accent);
		color: var(--on-maple);
		border: none;
		border-radius: 0.45rem;
		padding: 0.55rem 1.4rem;
		font-weight: 600;
	}
	.go:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.results {
		margin-top: 2rem;
	}
	.results-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.count {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0;
	}
	.save {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 0.45rem;
		color: var(--muted);
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.save:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	.result-actions,
	.save-form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.save-form select,
	.save-name {
		padding: 0.4rem 0.6rem;
		font-size: 0.85rem;
	}
	.save-name {
		width: 11rem;
	}
	.cancel {
		background: transparent;
		border: none;
		color: var(--muted);
		padding: 0.4rem 0.5rem;
		font-size: 0.85rem;
	}
	.cancel:hover {
		color: var(--text);
	}

	/* Header and every row use --cols (set inline from the result's widths), so
	   the word column always starts at the same x. Right-aligned front hooks keep
	   words aligned; numeric columns are fixed-width and right-aligned. */
	.thead {
		display: grid;
		grid-template-columns: var(--cols);
		column-gap: 0.5rem;
		padding: 0 0.85rem;
		border-bottom: 1px solid var(--border);
		height: 2.1rem;
		align-items: stretch;
	}

	.th {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		background: transparent;
		border: none;
		padding: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.c-num {
		justify-content: flex-end;
		text-align: right;
	}
	button.th {
		cursor: pointer;
	}
	button.th:hover {
		color: var(--text);
	}
	.th.active {
		color: var(--accent);
	}
	.arrow {
		font-size: 0.6rem;
	}
</style>
