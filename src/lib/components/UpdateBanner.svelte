<script lang="ts">
	import { slide } from 'svelte/transition';
	import { updater } from '$lib/updater/updater.svelte';

	// Which states warrant a banner. 'checking' stays silent (a manual check is
	// near-instant); the rest are actionable or worth confirming.
	const shown = $derived(
		updater.supported &&
			!updater.dismissed &&
			['available', 'downloading', 'installing', 'uptodate', 'error'].includes(updater.status)
	);

	const pct = $derived(Math.round(updater.progress * 100));

	// "Up to date" is a transient confirmation, not a standing banner — clear it.
	$effect(() => {
		if (updater.status === 'uptodate' && !updater.dismissed) {
			const t = setTimeout(() => updater.dismiss(), 4000);
			return () => clearTimeout(t);
		}
	});
</script>

{#if shown}
	<div class="update" class:error={updater.status === 'error'} role="status" transition:slide>
		{#if updater.status === 'available'}
			<span class="msg">
				<strong>euouae {updater.version}</strong> is available.
			</span>
			<span class="actions">
				<button class="primary" onclick={() => updater.install()}>Update now</button>
				<button class="ghost" onclick={() => updater.dismiss()}>Later</button>
			</span>
		{:else if updater.status === 'downloading'}
			<span class="msg">
				Downloading update{updater.contentLength > 0 ? ` — ${pct}%` : '…'}
				<span class="track" aria-hidden="true">
					<span class="fill" style:width={updater.contentLength > 0 ? `${pct}%` : '30%'}></span>
				</span>
			</span>
		{:else if updater.status === 'installing'}
			<span class="msg">Installing update — the app will restart…</span>
		{:else if updater.status === 'uptodate'}
			<span class="msg">You're on the latest version.</span>
			<span class="actions">
				<button class="ghost" aria-label="Dismiss" onclick={() => updater.dismiss()}>✕</button>
			</span>
		{:else if updater.status === 'error'}
			<span class="msg">Update failed: {updater.error}</span>
			<span class="actions">
				<button class="primary" onclick={() => updater.checkNow()}>Retry</button>
				<button class="ghost" aria-label="Dismiss" onclick={() => updater.dismiss()}>✕</button>
			</span>
		{/if}
	</div>
{/if}

<style>
	.update {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s4);
		flex-wrap: wrap;
		margin: var(--s4) var(--s5) 0;
		padding: 0.7rem 1rem;
		border-radius: var(--r);
		border: 1px solid var(--maple);
		background: var(--maple-ghost);
		color: var(--ink);
	}
	.update.error {
		border-color: var(--invalid);
		background: var(--invalid-wash);
		color: var(--invalid);
	}
	.msg {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	button {
		font: inherit;
		border-radius: var(--r-sm);
		padding: 0.35rem 0.8rem;
	}
	.primary {
		background: var(--maple);
		color: var(--on-maple);
		border: 1px solid transparent;
		font-weight: 600;
	}
	.primary:hover {
		filter: brightness(1.05);
	}
	.ghost {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-dim);
	}
	.ghost:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}
	.track {
		display: inline-block;
		width: 8rem;
		height: 5px;
		border-radius: var(--r-pill);
		background: color-mix(in oklab, var(--maple) 25%, transparent);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--maple);
		transition: width var(--t) var(--ease);
	}
</style>
