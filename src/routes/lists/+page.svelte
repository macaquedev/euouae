<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { ListStore, parseWords, type ListSummary } from '$lib/userdata/lists';
	import { buildExport, type ExportAttribute, type ExportFormat } from '$lib/userdata/export';
	import { saveTextFile } from '$lib/platform/download';
	import { CardStore } from '$lib/quiz/cards';
	import { plural } from '$lib/text';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ExportDialog from '$lib/components/ExportDialog.svelte';
	import RescheduleDialog from '$lib/components/RescheduleDialog.svelte';

	let store = $state<ListStore | null>(null);
	let lists = $state<ListSummary[]>([]);
	let name = $state('');
	let text = $state('');
	let target = $state<'new' | number>('new');
	let editingId = $state<number | null>(null);
	let editName = $state('');
	let exportTarget = $state<ListSummary | null>(null);
	let rescheduleTarget = $state<ListSummary | null>(null);
	let rescheduled = $state<{ id: number; count: number } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const targetName = $derived(
		typeof target === 'number' ? lists.find((l) => l.id === target)?.name : undefined
	);

	// A pending add/delete awaiting confirmation. requireText, when set, is the list
	// name the user must retype before a destructive delete is enabled.
	let confirmAction = $state<{
		title: string;
		message: string;
		confirmLabel: string;
		danger?: boolean;
		requireText?: string;
		run: () => void;
	} | null>(null);

	// Validating every word against the lexicon is a full pass over the list;
	// debounce it off the raw keystroke so pasting/importing a large list (or
	// just typing) doesn't re-scan on every character. `words` (what actually
	// gets saved) shares the same debounced source as the validity check, so
	// there's never a gap where the Save button looks enabled against words it
	// wouldn't actually save.
	const VALIDATE_DEBOUNCE_MS = 200;
	let debouncedText = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const value = text;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => (debouncedText = value), VALIDATE_DEBOUNCE_MS);
		return () => clearTimeout(debounceTimer);
	});

	const words = $derived(parseWords(debouncedText));
	const invalidWords = $derived(
		lexicon.engine ? words.filter((w) => !lexicon.engine!.isValid(w)) : []
	);

	onMount(async () => {
		store = await ListStore.open();
	});

	function refresh() {
		if (store) lists = store.summaries(lexicon.name);
	}

	// Lists are scoped to the active lexicon. Reload them when the store opens or the
	// lexicon switches, dropping any in-progress selection (compose target, rename,
	// pending dialog) that pointed at the lexicon we just left.
	let activeLex: string | null = null;
	$effect(() => {
		const lex = lexicon.name;
		const ready = store;
		untrack(() => {
			if (!ready) return;
			if (lex !== activeLex) {
				activeLex = lex;
				target = 'new';
				editingId = null;
				confirmAction = null;
				exportTarget = null;
				rescheduleTarget = null;
				rescheduled = null;
			}
			lists = ready.summaries(lex);
		});
	});

	const canSave = $derived(
		words.length > 0 &&
			invalidWords.length === 0 &&
			(target === 'new' ? name.trim().length > 0 : targetName !== undefined)
	);

	function requestSave() {
		if (!store || !canSave) return;
		const n = words.length;
		const dest = target === 'new' ? `new list “${name.trim()}”` : `“${targetName}”`;
		confirmAction = {
			title: 'Add words?',
			message: `Add ${plural(n)} to ${dest}?`,
			confirmLabel: 'Add',
			run: save
		};
	}

	function save() {
		if (!store || !canSave) return;
		if (target === 'new') {
			store.save(lexicon.name, name.trim(), words);
			name = '';
		} else {
			store.addWords(target, words);
		}
		text = '';
		refresh();
	}

	function startRename(list: ListSummary) {
		editingId = list.id;
		editName = list.name;
	}

	function commitRename() {
		if (editingId === null) return;
		const trimmed = editName.trim();
		if (trimmed) store?.rename(editingId, trimmed);
		editingId = null;
		refresh();
	}

	function cancelRename() {
		editingId = null;
	}

	function requestDelete(list: ListSummary) {
		confirmAction = {
			title: 'Delete list?',
			message: `This permanently deletes “${list.name}” (${plural(list.count)}). Type the list name to confirm.`,
			confirmLabel: 'Delete',
			danger: true,
			requireText: list.name,
			run: () => remove(list.id)
		};
	}

	function remove(id: number) {
		store?.remove(id);
		if (target === id) target = 'new';
		refresh();
	}

	function study(id: number) {
		goto(`${base}/quiz?deck=list-${id}`);
	}

	function marinate(id: number) {
		goto(`${base}/marinate?list=${id}`);
	}

	function exportList(list: ListSummary) {
		exportTarget = list;
	}

	function rescheduleList(list: ListSummary) {
		rescheduled = null;
		rescheduleTarget = list;
	}

	async function runReschedule(days: number) {
		const list = rescheduleTarget;
		rescheduleTarget = null;
		if (!list) return;
		const cards = await CardStore.open(lexicon.name, `list-${list.id}`);
		rescheduled = { id: list.id, count: cards.reschedule(days) };
	}

	async function runExport(format: ExportFormat, attributes: ExportAttribute[]) {
		const list = exportTarget;
		exportTarget = null;
		if (!store || !list) return;
		const body = buildExport(store.orderedWords(list.id), lexicon.engine, format, attributes);
		const filename = `${list.name.replace(/[^\w-]+/g, '_')}.txt`;
		await saveTextFile(filename, body, { name: 'Text', extensions: ['txt'] });
	}

	// One-click fix for a paste/import with words the lexicon rejects: keep only
	// the valid ones (deduplicated, one per line) instead of hand-editing.
	function dropInvalid() {
		if (!lexicon.engine) return;
		text = words.filter((w) => lexicon.engine!.isValid(w)).join('\n');
	}

	async function importFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		text = (await file.text()).toUpperCase();
		if (!name.trim()) name = file.name.replace(/\.[^.]+$/, '');
	}

	function fmtDate(epoch: number): string {
		return new Date(epoch * 1000).toLocaleDateString();
	}
</script>

<section class="lists">
	<header class="head">
		<span class="eyebrow">Lists</span>
		<h1>Your word lists</h1>
		<p class="muted">Build study lists by hand, from a file, or saved from a search. Click a name to rename it.</p>
	</header>

	<div class="create">
		<h2>Add words</h2>
		<div class="target">
			<select bind:value={target}>
				<option value="new">＋ New list…</option>
				{#each lists as list (list.id)}
					<option value={list.id}>{list.name}</option>
				{/each}
			</select>
			{#if target === 'new'}
				<input class="name" bind:value={name} placeholder="List name" maxlength="80" />
			{/if}
		</div>
		<div class="editor">
			<textarea
				bind:value={text}
				rows="5"
				spellcheck="false"
				autocapitalize="characters"
				autocomplete="off"
				placeholder="Paste or type words separated by spaces or new lines"
			></textarea>
		</div>
		<div class="create-bar">
			<input
				bind:this={fileInput}
				type="file"
				accept=".txt,text/plain"
				onchange={importFile}
				hidden
			/>
			<button type="button" class="import" onclick={() => fileInput?.click()}>
				Import file
			</button>
			{#if invalidWords.length > 0}
				<p class="note err">
					{plural(invalidWords.length, 'word')} not in {lexicon.name}, including {invalidWords[0]}
					<button type="button" class="drop" onclick={dropInvalid}>Drop them</button>
				</p>
			{/if}
			<button class="primary" onclick={requestSave} disabled={!canSave}>
				{target === 'new' ? 'Save list' : `Add to ${targetName}`}
			</button>
		</div>
	</div>

	<h2>Saved lists</h2>
	{#if lists.length === 0}
		<p class="muted">No lists yet. Create one above, or save a search from the Search page.</p>
	{:else}
		<ul class="saved">
			{#each lists as list (list.id)}
				<li>
					<div class="info">
						{#if editingId === list.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="rename"
								bind:value={editName}
								maxlength="80"
								autofocus
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									else if (e.key === 'Escape') cancelRename();
								}}
								onblur={commitRename}
							/>
						{:else}
							<button class="lname" title="Click to rename" onclick={() => startRename(list)}>
								{list.name}
							</button>
						{/if}
						<span class="meta">
							{list.count} words · {fmtDate(list.created)}
							{#if rescheduled?.id === list.id}
								· rescheduled {plural(rescheduled.count, 'card')}
							{/if}
						</span>
					</div>
					<div class="row-actions">
						<button class="ghost" onclick={() => marinate(list.id)}>Marinate</button>
						<button class="ghost" onclick={() => study(list.id)}>Study</button>
						<button class="ghost" onclick={() => rescheduleList(list)}>Reschedule</button>
						<button class="ghost" onclick={() => exportList(list)}>Export</button>
						<button class="ghost danger" onclick={() => requestDelete(list)}>Delete</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if confirmAction}
	<ConfirmModal
		title={confirmAction.title}
		message={confirmAction.message}
		confirmLabel={confirmAction.confirmLabel}
		danger={confirmAction.danger}
		requireText={confirmAction.requireText}
		onconfirm={() => {
			confirmAction?.run();
			confirmAction = null;
		}}
		oncancel={() => (confirmAction = null)}
	/>
{/if}

{#if exportTarget}
	<ExportDialog
		listName={exportTarget.name}
		onconfirm={({ format, attributes }) => runExport(format, attributes)}
		oncancel={() => (exportTarget = null)}
	/>
{/if}

{#if rescheduleTarget}
	<RescheduleDialog
		listName={rescheduleTarget.name}
		onconfirm={runReschedule}
		oncancel={() => (rescheduleTarget = null)}
	/>
{/if}

<style>
	.lists {
		max-width: 46rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	.head {
		margin-bottom: var(--s5);
	}
	.head h1 {
		margin: var(--s2) 0;
		font-size: clamp(1.5rem, 4vw, 2rem);
		font-weight: 600;
	}
	.head p {
		margin: 0;
		max-width: 34rem;
	}

	h2 {
		font-size: 1rem;
		margin: 2rem 0 0.8rem;
	}
	.create h2 {
		margin-top: 0;
	}

	.create {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 1.1rem;
	}

	.target {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}
	.target select {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
		font: inherit;
		outline: none;
		max-width: 16rem;
	}
	.target select:focus {
		border-color: var(--accent);
	}
	.target .name {
		flex: 1;
		margin-bottom: 0;
	}

	input.name,
	textarea {
		width: 100%;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
		font: inherit;
		outline: none;
		margin-bottom: 0.7rem;
	}
	input.name:focus,
	textarea:focus {
		border-color: var(--accent);
	}

	.editor {
		position: relative;
		margin-bottom: 0.7rem;
	}

	.editor textarea {
		font-family: var(--font-word);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		margin-bottom: 0;
		resize: vertical;
	}

	textarea::placeholder {
		text-transform: none;
		letter-spacing: normal;
	}

	.create-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.import {
		border: 1px dashed var(--border);
		border-radius: 0.45rem;
		color: var(--muted);
		padding: 0.45rem 0.8rem;
		cursor: pointer;
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.import:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	/* Matches the inline validation note style from CreateLexiconDialog. */
	.note {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note.err {
		color: var(--invalid);
	}
	.note .drop {
		margin-left: 0.5rem;
		color: inherit;
		font-size: inherit;
		font-weight: 600;
		text-decoration: underline;
		padding: 0;
	}

	.primary {
		margin-left: auto;
		background: var(--accent);
		color: var(--on-maple);
		border: none;
		border-radius: 0.45rem;
		padding: 0.55rem 1.2rem;
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.saved {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.saved li {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		padding: 0.7rem 0.9rem;
	}
	.info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.lname {
		font: inherit;
		font-weight: 600;
		background: none;
		border: none;
		color: var(--text);
		padding: 0.1rem 0.3rem;
		margin-left: -0.3rem;
		border-radius: 0.3rem;
		text-align: left;
		cursor: text;
		align-self: flex-start;
	}
	.lname:hover {
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.lname::after {
		content: '✎';
		font-size: 0.8em;
		color: var(--muted);
		margin-left: 0.45rem;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.lname:hover::after,
	.lname:focus-visible::after {
		opacity: 1;
	}
	input.rename {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--accent);
		border-radius: 0.4rem;
		padding: 0.25rem 0.5rem;
		font: inherit;
		font-weight: 600;
		outline: none;
		margin: 0;
		width: 16rem;
		max-width: 100%;
	}
	.meta {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.row-actions {
		margin-left: auto;
		display: flex;
		gap: 0.4rem;
	}

	.ghost {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		color: var(--muted);
		padding: 0.35rem 0.7rem;
		font-size: 0.85rem;
	}
	.ghost:hover {
		color: var(--text);
		border-color: var(--accent);
	}
	.ghost.danger:hover {
		color: var(--invalid);
		border-color: var(--invalid);
	}

	.muted {
		color: var(--muted);
	}
</style>
