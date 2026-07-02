// Desktop auto-update via the Tauri updater plugin. A background check runs
// once on launch; if a newer signed release is published the layout surfaces a
// banner (UpdateBanner.svelte) offering to download, install, and relaunch.
// Everything is a no-op outside the Tauri shell — a plain browser/PWA has no
// updater — so the plugin APIs are only imported behind an explicit Tauri check
// (same rule as the rest of the app; see platform/storage.ts).

import type { Update } from '@tauri-apps/plugin-updater';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type UpdaterStatus =
	| 'idle'
	| 'checking'
	| 'available'
	| 'downloading'
	| 'installing'
	| 'uptodate'
	| 'error';

class Updater {
	status = $state<UpdaterStatus>('idle');
	/** The newer version on offer, once a check finds one. */
	version = $state<string | null>(null);
	error = $state<string | null>(null);
	downloaded = $state(0);
	contentLength = $state(0);
	/** User closed the banner for the current result; reset on the next check. */
	dismissed = $state(false);

	private pending: Update | null = null;

	/** True only in the desktop shell; the PWA has no updater. */
	get supported(): boolean {
		return isTauri();
	}

	/** Fraction downloaded (0–1), or 0 when the total isn't known yet. */
	get progress(): number {
		return this.contentLength > 0 ? Math.min(1, this.downloaded / this.contentLength) : 0;
	}

	/** Background check on launch. Silent on failure or when up to date — a
	 *  startup check should never nag (e.g. the machine is simply offline). */
	async init(): Promise<void> {
		if (!isTauri() || this.status !== 'idle') return;
		try {
			const update = await this.runCheck();
			if (update) this.present(update);
		} catch {
			// Endpoint unreachable at launch: stay quiet.
		}
	}

	/** User-initiated check; unlike init() it surfaces "up to date" and errors. */
	async checkNow(): Promise<void> {
		if (!isTauri()) return;
		if (this.status === 'downloading' || this.status === 'installing') return;
		this.dismissed = false;
		this.error = null;
		this.status = 'checking';
		try {
			const update = await this.runCheck();
			if (update) this.present(update);
			else this.status = 'uptodate';
		} catch (err) {
			this.error = this.msg(err);
			this.status = 'error';
		}
	}

	/** Download and install the pending update, then relaunch into it. */
	async install(): Promise<void> {
		if (!isTauri() || !this.pending) return;
		this.error = null;
		this.downloaded = 0;
		this.contentLength = 0;
		this.status = 'downloading';
		try {
			await this.pending.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					this.contentLength = event.data.contentLength ?? 0;
				} else if (event.event === 'Progress') {
					this.downloaded += event.data.chunkLength;
				} else if (event.event === 'Finished') {
					this.status = 'installing';
				}
			});
			const { relaunch } = await import('@tauri-apps/plugin-process');
			await relaunch();
		} catch (err) {
			this.error = this.msg(err);
			this.status = 'error';
		}
	}

	dismiss(): void {
		this.dismissed = true;
	}

	private async runCheck(): Promise<Update | null> {
		const { check } = await import('@tauri-apps/plugin-updater');
		return check();
	}

	private present(update: Update): void {
		this.pending = update;
		this.version = update.version;
		this.status = 'available';
		this.dismissed = false;
	}

	private msg(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}

export const updater = new Updater();
