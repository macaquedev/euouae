<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { overlayDuration } from '$lib/motion';
	import { trapFocus } from '$lib/keyboard/focusTrap';
	import { kbd } from '$lib/keyboard/ui.svelte';
	import {
		exportProgress,
		readProgressBundle,
		applyProgressBundle,
		PROGRESS_EXTENSION,
		type ParsedProgress,
		type ImportMode
	} from '$lib/userdata/progress';

	const dur = overlayDuration();

	// A backup carries every lexicon .db, so it can be large; guard against a
	// wildly-wrong file rather than trying to read gigabytes into memory.
	const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

	type Phase = 'menu' | 'busy' | 'confirm';

	let phase = $state<Phase>('menu');
	let busyLabel = $state('');
	let error = $state<string | null>(null);
	let parsed = $state<ParsedProgress | null>(null);
	let fileName = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

	function fail(message: string) {
		error = message;
		phase = 'menu';
		parsed = null;
	}

	async function runExport() {
		error = null;
		busyLabel = 'Packing your progress…';
		phase = 'busy';
		try {
			const bytes = await exportProgress();
			const date = new Date().toISOString().slice(0, 10);
			await saveBinaryFile(`euouae-progress-${date}.${PROGRESS_EXTENSION}`, bytes);
			kbd.close();
		} catch (err) {
			fail(`Couldn't export your progress: ${msg(err)}`);
		}
	}

	async function onFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > MAX_IMPORT_BYTES) {
			fail(`${file.name} is too large to be a progress backup.`);
			return;
		}
		error = null;
		busyLabel = 'Reading backup…';
		phase = 'busy';
		try {
			const bundle = await readProgressBundle(new Uint8Array(await file.arrayBuffer()));
			parsed = bundle;
			fileName = file.name;
			phase = 'confirm';
		} catch (err) {
			fail(msg(err));
		}
	}

	async function confirmImport(mode: ImportMode) {
		if (!parsed) return;
		error = null;
		busyLabel = mode === 'merge' ? 'Merging your progress…' : 'Restoring your progress…';
		phase = 'busy';
		try {
			await applyProgressBundle(parsed.files, mode);
			// Reload so every store and engine re-opens from the updated data — for
			// replace the live DB is stale (persistence is now suspended); for merge
			// the catalog of custom lexicons has changed.
			location.reload();
		} catch (err) {
			fail(`Couldn't import this backup: ${msg(err)}`);
		}
	}

	async function saveBinaryFile(filename: string, bytes: Uint8Array) {
		// The Tauri webview has no download manager (the anchor trick is a silent
		// no-op there): ask for a path natively and write the bytes ourselves.
		if ('__TAURI_INTERNALS__' in window) {
			const { save } = await import('@tauri-apps/plugin-dialog');
			const { writeFile } = await import('@tauri-apps/plugin-fs');
			const path = await save({
				defaultPath: filename,
				filters: [{ name: 'euouae progress', extensions: [PROGRESS_EXTENSION] }]
			});
			if (path) await writeFile(path, bytes);
			return;
		}

		// exportProgress() returns an ArrayBuffer-backed array, so this cast is safe.
		const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	const createdAtLabel = $derived(
		parsed?.summary.createdAt != null
			? new Date(parsed.summary.createdAt).toLocaleString()
			: null
	);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && phase !== 'busy') {
			event.preventDefault();
			kbd.close();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" transition:fade={{ duration: dur }}>
	<button class="backdrop" tabindex="-1" aria-label="Close" onclick={() => kbd.close()}></button>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label="Backup and restore progress"
		use:trapFocus
		transition:scale={{ duration: dur, start: 0.97, opacity: 0 }}
	>
		<h2>Progress backup</h2>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if phase === 'busy'}
			<div class="busy" role="status">
				<span class="spinner" aria-hidden="true"></span>
				<span>{busyLabel}</span>
			</div>
		{:else if phase === 'confirm' && parsed}
			<p class="lead">
				<strong>{fileName}</strong> — choose how to bring it into this device.
			</p>
			<ul class="summary">
				{#if parsed.summary.cards != null}
					<li><span>{parsed.summary.cards.toLocaleString()}</span> cards</li>
				{/if}
				{#if parsed.summary.lists != null}
					<li><span>{parsed.summary.lists.toLocaleString()}</span> lists</li>
				{/if}
				<li><span>{parsed.summary.lexicons.toLocaleString()}</span> custom lexicons</li>
				{#if createdAtLabel}
					<li class="when">Backed up {createdAtLabel}</li>
				{/if}
			</ul>
			<div class="choices">
				<button type="button" class="choice" onclick={() => confirmImport('merge')}>
					<span class="choice-title">Merge into this device</span>
					<span class="choice-sub">
						Keep what's already here and add the backup's progress. Newer reviews win; lists and
						custom lexicons combine.
					</span>
				</button>
				<button
					type="button"
					class="choice danger-choice"
					onclick={() => confirmImport('replace')}
				>
					<span class="choice-title">Replace everything</span>
					<span class="choice-sub">
						Erase this device's data and restore exactly what's in the backup. This can't be undone.
					</span>
				</button>
			</div>
			<div class="actions">
				<button type="button" class="cancel" onclick={() => ((phase = 'menu'), (parsed = null))}>
					Choose a different file
				</button>
			</div>
		{:else}
			<p class="lead">
				Save everything — your lists, learning progress, and custom lexicons — to one file, or
				restore from a backup made here or on another device.
			</p>
			<div class="choices">
				<button type="button" class="choice" onclick={runExport}>
					<span class="choice-title">Export progress</span>
					<span class="choice-sub">Download a single backup file.</span>
				</button>
				<button type="button" class="choice" onclick={() => fileInput?.click()}>
					<span class="choice-title">Import progress</span>
					<span class="choice-sub">Restore from a backup file.</span>
				</button>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept=".{PROGRESS_EXTENSION}"
				onchange={onFile}
				hidden
			/>
			<div class="actions">
				<button type="button" class="cancel" onclick={() => kbd.close()}>Close</button>
			</div>
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
		padding-top: 12vh;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		background: rgba(4, 7, 5, 0.6);
		backdrop-filter: blur(3px);
		cursor: default;
	}
	.modal {
		position: relative;
		width: min(92vw, 30rem);
		max-height: 80vh;
		overflow-y: auto;
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		padding: var(--s5);
	}

	h2 {
		margin: 0 0 var(--s3);
		font-size: 1.1rem;
		font-weight: 600;
	}
	.lead {
		margin: 0 0 var(--s4);
		color: var(--ink-dim);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.error {
		margin: 0 0 var(--s4);
		color: var(--invalid);
		background: var(--invalid-wash);
		border: 1px solid var(--invalid);
		border-radius: var(--r-sm);
		padding: 0.6rem 0.8rem;
		font-size: 0.85rem;
	}

	.choices {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	.choice {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		text-align: left;
		padding: 0.8rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
	}
	.choice:hover {
		border-color: var(--maple);
	}
	.choice-title {
		font-weight: 600;
	}
	.choice-sub {
		font-size: 0.82rem;
		color: var(--ink-dim);
		line-height: 1.45;
	}
	.danger-choice:hover {
		border-color: var(--invalid);
	}
	.danger-choice .choice-title {
		color: var(--invalid);
	}

	.summary {
		list-style: none;
		margin: 0 0 var(--s4);
		padding: 0.7rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.1rem;
		font-size: 0.85rem;
		color: var(--ink-dim);
	}
	.summary li span {
		font-weight: 600;
		color: var(--ink);
	}
	.summary .when {
		flex-basis: 100%;
		color: var(--ink-faint);
		font-size: 0.8rem;
	}

	.busy {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: var(--s4) 0;
		color: var(--ink-dim);
	}
	.spinner {
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--line-strong);
		border-top-color: var(--maple);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--s2);
		margin-top: var(--s5);
	}
	.cancel {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		color: var(--ink-dim);
		padding: 0.5rem 1rem;
	}
	.cancel:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}
</style>
