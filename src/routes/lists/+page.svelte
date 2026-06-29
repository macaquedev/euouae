<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { lexicon } from '$lib/lexicon/store.svelte';
	import { ListStore, parseWords, type ListSummary } from '$lib/userdata/lists';
	import { buildExport, type ExportAttribute, type ExportFormat } from '$lib/userdata/export';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import ExportDialog from '$lib/components/ExportDialog.svelte';

	let store = $state<ListStore | null>(null);
	let lists = $state<ListSummary[]>([]);
	let name = $state('');
	let text = $state('');
	let target = $state<'new' | number>('new');
	let editingId = $state<number | null>(null);
	let editName = $state('');
	let exportTarget = $state<ListSummary | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let backdrop = $state<HTMLDivElement | null>(null);

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

	const words = $derived(parseWords(text));
	const invalidWords = $derived(
		lexicon.engine ? words.filter((w) => !lexicon.engine!.isValid(w)) : []
	);

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// Mirror of the textarea's text with whitespace-separated tokens that aren't in
	// the lexicon wrapped so the backdrop layer can highlight them in place.
	const highlighted = $derived(
		text.replace(/\S+|\s+/g, (chunk) =>
			/\S/.test(chunk) && lexicon.engine && !lexicon.engine.isValid(chunk)
				? `<mark>${escapeHtml(chunk)}</mark>`
				: escapeHtml(chunk)
		)
	);

	function onInput(event: Event) {
		text = (event.currentTarget as HTMLTextAreaElement).value.toUpperCase();
	}

	function syncScroll() {
		if (backdrop && textarea) backdrop.scrollTop = textarea.scrollTop;
	}

	onMount(async () => {
		store = await ListStore.open();
		refresh();
	});

	function refresh() {
		if (store) lists = store.summaries(lexicon.name);
	}

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
			message: `Add ${n} word${n === 1 ? '' : 's'} to ${dest}?`,
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
			message: `This permanently deletes “${list.name}” (${list.count} word${list.count === 1 ? '' : 's'}). Type the list name to confirm.`,
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

	async function runExport(format: ExportFormat, attributes: ExportAttribute[]) {
		const list = exportTarget;
		exportTarget = null;
		if (!store || !list) return;
		const body = buildExport(store.orderedWords(list.id), lexicon.engine, format, attributes);
		const filename = `${list.name.replace(/[^\w-]+/g, '_')}.txt`;
		await saveTextFile(filename, body);
	}

	async function saveTextFile(filename: string, body: string) {
		// The Tauri webview has no download manager, so the browser anchor trick is a
		// silent no-op there: ask for a path natively and write the file ourselves.
		if ('__TAURI_INTERNALS__' in window) {
			const { save } = await import('@tauri-apps/plugin-dialog');
			const { writeTextFile } = await import('@tauri-apps/plugin-fs');
			const path = await save({
				defaultPath: filename,
				filters: [{ name: 'Text', extensions: ['txt'] }]
			});
			if (path) await writeTextFile(path, body);
			return;
		}

		const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		// Firefox needs the anchor in the DOM for a programmatic click, and the
		// object URL must outlive the click (revoking synchronously cancels the
		// download), so tidy up on the next tick.
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
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
			<div class="backdrop" aria-hidden="true" bind:this={backdrop}>{@html highlighted}</div>
			<textarea
				bind:this={textarea}
				value={text}
				oninput={onInput}
				onscroll={syncScroll}
				rows="5"
				spellcheck="false"
				autocapitalize="characters"
				autocomplete="off"
				placeholder="Paste or type words separated by spaces or new lines"
			></textarea>
		</div>
		<div class="create-bar">
			<label class="import">
				Import file
				<input type="file" accept=".txt,text/plain" onchange={importFile} hidden />
			</label>
			<span class="muted" class:warn={invalidWords.length > 0}>
				{words.length} word{words.length === 1 ? '' : 's'}
				{#if invalidWords.length}· {invalidWords.length} not in {lexicon.name}{:else if words.length}· all in {lexicon.name}{/if}
			</span>
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
						<span class="meta">{list.count} words · {fmtDate(list.created)}</span>
					</div>
					<div class="row-actions">
						<button class="ghost" onclick={() => marinate(list.id)}>Marinate</button>
						<button class="ghost" onclick={() => study(list.id)}>Study</button>
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

	/* The textarea and its highlight backdrop must share an identical box model so
	   their text lays out character-for-character; the textarea floats on top with
	   a transparent background, letting the backdrop's marks show through. */
	.editor textarea,
	.backdrop {
		font-family: var(--font-word);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}
	.editor textarea {
		position: relative;
		margin-bottom: 0;
		background: transparent;
		resize: vertical;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
		font-size: inherit;
		line-height: inherit;
		color: transparent;
	}
	.backdrop :global(mark) {
		background: color-mix(in srgb, var(--invalid) 28%, transparent);
		color: transparent;
		border-radius: 0.2rem;
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
	.muted.warn {
		color: var(--invalid);
	}
</style>
