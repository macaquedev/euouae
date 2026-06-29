// The five pillars, defined once and shared by the top nav, the command palette,
// and the "g then key" jump shortcuts — so a route, its label, and its shortcut
// can never drift apart.

export interface NavItem {
	/** Route under base, '' = home (Judge). */
	readonly href: string;
	readonly label: string;
	/** Second key of the "g <key>" jump shortcut. */
	readonly key: string;
	readonly hint: string;
}

export const NAV: readonly NavItem[] = [
	{ href: '', label: 'Judge', key: 'j', hint: 'Rule whether a play is acceptable' },
	{ href: 'word', label: 'Word Info', key: 'w', hint: 'Definition, hooks and probability of a word' },
	{ href: 'search', label: 'Search', key: 's', hint: 'Find words by pattern, length, letters…' },
	{ href: 'quiz', label: 'Study', key: 'q', hint: 'Drill anagrams with spaced repetition' },
	{ href: 'lists', label: 'Lists', key: 'l', hint: 'Build and manage word lists' }
];
