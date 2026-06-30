// One definition of the reduced-motion preference, shared by every page
// transition and overlay so animations honor the OS setting consistently.

/** True when the user has asked the OS to minimize non-essential motion. */
export function prefersReducedMotion(): boolean {
	return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Standard fade/scale duration for overlays — collapsed to 0 when motion is reduced. */
export function overlayDuration(): number {
	return prefersReducedMotion() ? 0 : 150;
}
