// Traps Tab focus inside `node` (wrapping from the last focusable element back
// to the first, and vice versa) for as long as it's mounted, and restores
// focus to whatever was focused immediately before mount once it's torn down —
// the same remember/restore discipline `keyboard/ui.svelte.ts` already uses
// for the command palette, generalized as an action so every dialog/menu gets
// it for free instead of reimplementing it.
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(node: HTMLElement) {
	const returnTo = document.activeElement as HTMLElement | null;

	function focusables(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const items = focusables();
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			returnTo?.focus?.();
		}
	};
}
