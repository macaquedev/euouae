// Shared open/closed state for the keyboard overlays (command palette and the
// shortcuts help), plus remembering which element to return focus to on close —
// so dismissing an overlay never strands the keyboard user.

class KeyboardUI {
	palette = $state(false);
	help = $state(false);
	lexiconPicker = $state(false);
	progress = $state(false);
	theme = $state(false);
	/**
	 * Set while something outside this store's own overlay set owns the
	 * keyboard exclusively — a kiosk surface (Word Judge) or a standalone
	 * dialog (ConfirmModal, ExportDialog, CreateLexiconDialog) that isn't
	 * routed through palette/help/lexiconPicker. Blocks every global
	 * shortcut, including Ctrl+K, so nothing can open or navigate out from
	 * under it.
	 */
	locked = $state(false);
	private returnTo: HTMLElement | null = null;

	// Only capture on the first overlay of a chain — if one overlay opens
	// another directly (e.g. the command palette's "Switch lexicon" command),
	// the currently-focused element belongs to the overlay that's about to
	// unmount, not to whatever was focused before the chain started.
	private remember() {
		if (this.anyOpen) return;
		this.returnTo = document.activeElement as HTMLElement | null;
	}

	openPalette() {
		if (this.palette || this.locked) return;
		this.remember();
		this.help = false;
		this.lexiconPicker = false;
		this.palette = true;
	}

	openHelp() {
		if (this.help || this.locked) return;
		this.remember();
		this.palette = false;
		this.lexiconPicker = false;
		this.help = true;
	}

	openLexiconPicker() {
		if (this.locked) return;
		this.remember();
		this.palette = false;
		this.help = false;
		this.lexiconPicker = true;
	}

	openProgress() {
		if (this.locked) return;
		this.remember();
		this.palette = false;
		this.help = false;
		this.lexiconPicker = false;
		this.progress = true;
	}

	openTheme() {
		if (this.locked) return;
		this.remember();
		this.palette = false;
		this.help = false;
		this.lexiconPicker = false;
		this.progress = false;
		this.theme = true;
	}

	lock() {
		this.close();
		this.locked = true;
	}

	unlock() {
		this.locked = false;
	}

	close() {
		this.palette = false;
		this.help = false;
		this.lexiconPicker = false;
		this.progress = false;
		this.theme = false;
		this.returnTo?.focus?.();
		this.returnTo = null;
	}

	get anyOpen() {
		return this.palette || this.help || this.lexiconPicker || this.progress || this.theme;
	}
}

export const kbd = new KeyboardUI();
