// Kiosk controls for the Word Judge. In the Tauri desktop shell this drives the
// native window (true fullscreen + always-on-top); in a plain browser it falls
// back to the Fullscreen API. Both are best-effort and safe to call anywhere.

async function tauriWindow() {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
	const { getCurrentWindow } = await import('@tauri-apps/api/window');
	return getCurrentWindow();
}

/** Lock the screen for judging: native fullscreen + on-top, else browser fullscreen. */
export async function enterKiosk(): Promise<void> {
	const win = await tauriWindow();
	if (win) {
		await win.setFullscreen(true);
		await win.setAlwaysOnTop(true);
		return;
	}
	try {
		await document.documentElement.requestFullscreen?.();
	} catch {
		// Fullscreen can be refused (no user gesture); the overlay still covers the app.
	}
}

/** Release the kiosk lock and restore the normal window. */
export async function exitKiosk(): Promise<void> {
	const win = await tauriWindow();
	if (win) {
		await win.setAlwaysOnTop(false);
		await win.setFullscreen(false);
		return;
	}
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
	} catch {
		// Already out of fullscreen.
	}
}
