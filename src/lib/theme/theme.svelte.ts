// Colour-scheme selection. Each theme is a self-contained palette defined in
// app.css under [data-theme='<id>']; this store just remembers which one is
// active, applies it by stamping data-theme on <html>, and persists the choice.
//
// The preference is a trivial bit of UI state, so it lives in localStorage
// (present in both shells — the Tauri webview has it too) rather than the
// app-data storage layer, which is reserved for the user's database and
// lexicons. An inline script in app.html applies the saved theme before first
// paint (see IDS / DEFAULT below, kept in sync), so switching never flashes.

export type ThemeMode = 'dark' | 'light';

export interface Theme {
	id: string;
	label: string;
	mode: ThemeMode;
	blurb: string;
	/** Three representative colours for the picker's preview chip. */
	swatch: { bg: string; accent: string; ink: string };
}

export const THEMES: Theme[] = [
	{
		id: 'night',
		label: 'Night Board',
		mode: 'dark',
		blurb: 'Green felt & maple',
		swatch: { bg: '#0c100e', accent: '#e6b36b', ink: '#ecefea' }
	},
	{
		id: 'onyx',
		label: 'Onyx',
		mode: 'dark',
		blurb: 'True-black OLED',
		swatch: { bg: '#000000', accent: '#efbd76', ink: '#ffffff' }
	},
	{
		id: 'nocturne',
		label: 'Nocturne',
		mode: 'dark',
		blurb: 'Indigo & periwinkle',
		swatch: { bg: '#0b0e1a', accent: '#aeb8ff', ink: '#e8ebf6' }
	},
	{
		id: 'parchment',
		label: 'Parchment',
		mode: 'light',
		blurb: 'Warm cream paper',
		swatch: { bg: '#efe6d2', accent: '#9c6a1a', ink: '#2c2a24' }
	},
	{
		id: 'daylight',
		label: 'Daylight',
		mode: 'light',
		blurb: 'Crisp cool white',
		swatch: { bg: '#eef1f4', accent: '#0f7d78', ink: '#1c2530' }
	}
];

export const DEFAULT_THEME = 'night';
const STORAGE_KEY = 'euouae:theme';

const isKnown = (id: string | null | undefined): id is string =>
	!!id && THEMES.some((t) => t.id === id);

class ThemeStore {
	current = $state<string>(DEFAULT_THEME);

	/**
	 * Adopt whatever's already on <html> (the no-flash script picked it from the
	 * saved preference or the OS colour scheme). Never persists here — a stored
	 * preference is only written when the user picks one, so first-run users keep
	 * following their OS until they choose.
	 */
	init() {
		if (typeof document === 'undefined') return;
		const saved = safeGet();
		const applied = document.documentElement.dataset.theme;
		this.current = isKnown(saved) ? saved : isKnown(applied) ? applied : DEFAULT_THEME;
		this.apply(this.current);
	}

	set(id: string) {
		if (!isKnown(id)) return;
		this.current = id;
		this.apply(id);
		safeSet(id);
	}

	private apply(id: string) {
		if (typeof document !== 'undefined') document.documentElement.dataset.theme = id;
	}

	get theme(): Theme {
		return THEMES.find((t) => t.id === this.current) ?? THEMES[0];
	}
}

function safeGet(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function safeSet(id: string) {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		/* private mode / disabled storage — the choice just won't persist */
	}
}

export const theme = new ThemeStore();
