// Shared open/closed state for the keyboard overlays (command palette and the
// shortcuts help), plus remembering which element to return focus to on close —
// so dismissing an overlay never strands the keyboard user.

class KeyboardUI {
	palette = $state(false);
	help = $state(false);
	private returnTo: HTMLElement | null = null;

	private remember() {
		this.returnTo = document.activeElement as HTMLElement | null;
	}

	openPalette() {
		if (this.palette) return;
		this.remember();
		this.help = false;
		this.palette = true;
	}

	openHelp() {
		if (this.help) return;
		this.remember();
		this.palette = false;
		this.help = true;
	}

	close() {
		this.palette = false;
		this.help = false;
		this.returnTo?.focus?.();
		this.returnTo = null;
	}

	get anyOpen() {
		return this.palette || this.help;
	}
}

export const kbd = new KeyboardUI();
