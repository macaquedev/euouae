// Saved word lists. A list is just a named bag of words scoped to a lexicon,
// stored in the writable user DB. Lists feed the quiz as decks and can be
// imported/exported as plain text. Persisted the same way as card state.

import type { Database } from '@sqlite.org/sqlite-wasm';
import { epochSeconds } from '$lib/time';
import { persistUserData, userDb } from './db';

export interface ListSummary {
	readonly id: number;
	readonly name: string;
	readonly count: number;
	readonly created: number;
}

/** Split user text on whitespace into an uppercased, de-duplicated set of tokens.
 *  Whitespace is the only separator: a token keeps any punctuation attached, which
 *  the Lists UI then flags as invalid since it can't match a lexicon word. */
export function parseWords(text: string): string[] {
	return [...new Set(text.toUpperCase().split(/\s+/).filter(Boolean))];
}

export class ListStore {
	private constructor(private readonly db: Database) {}

	static async open(): Promise<ListStore> {
		return new ListStore(await userDb());
	}

	/** Create a list from already-cleaned words; returns the new list id. */
	create(lexicon: string, name: string, words: string[]): number {
		const created = epochSeconds();
		this.db.exec({
			sql: 'INSERT INTO lists (lexicon, name, created) VALUES (?, ?, ?)',
			bind: [lexicon, name, created]
		});
		const id = this.db.selectValue('SELECT last_insert_rowid()') as number;
		words.forEach((word, position) => {
			this.db.exec({
				sql: 'INSERT OR IGNORE INTO list_words (list_id, word, position) VALUES (?, ?, ?)',
				bind: [id, word, position]
			});
		});
		void persistUserData();
		return id;
	}

	/** The id of the list with this name in this lexicon, or undefined. Names are
	 *  not unique in the schema; the oldest match wins, so saves coalesce onto the
	 *  first list of that name rather than whichever was created last. */
	findByName(lexicon: string, name: string): number | undefined {
		const row = this.db.selectValue(
			'SELECT id FROM lists WHERE lexicon = ? AND name = ? ORDER BY created, id LIMIT 1',
			[lexicon, name]
		);
		return row == null ? undefined : (row as number);
	}

	/** Save words under a name: append to the existing list of that name if there
	 *  is one, else create it. Returns the target id, how many words were new, and
	 *  whether the list was freshly created. Avoids silently spawning duplicate
	 *  same-named decks. */
	save(
		lexicon: string,
		name: string,
		words: string[]
	): { id: number; added: number; created: boolean } {
		const existing = this.findByName(lexicon, name);
		if (existing !== undefined) {
			return { id: existing, added: this.addWords(existing, words), created: false };
		}
		const id = this.create(lexicon, name, words);
		return { id, added: words.length, created: true };
	}

	/** Append words to an existing list, after its current ones; returns how many
	 *  were actually new (duplicates already in the list are ignored). */
	addWords(id: number, words: string[]): number {
		const start =
			(this.db.selectValue('SELECT COALESCE(MAX(position), -1) FROM list_words WHERE list_id = ?', [
				id
			]) as number) + 1;
		let added = 0;
		words.forEach((word, i) => {
			this.db.exec({
				sql: 'INSERT OR IGNORE INTO list_words (list_id, word, position) VALUES (?, ?, ?)',
				bind: [id, word, start + i]
			});
			added += this.db.changes();
		});
		void persistUserData();
		return added;
	}

	summaries(lexicon: string): ListSummary[] {
		return this.db
			.selectObjects(
				`SELECT l.id, l.name, l.created, COUNT(w.word) AS count
				 FROM lists l LEFT JOIN list_words w ON w.list_id = l.id
				 WHERE l.lexicon = ?
				 GROUP BY l.id ORDER BY l.created DESC`,
				[lexicon]
			)
			.map((r) => ({
				id: r.id as number,
				name: r.name as string,
				created: r.created as number,
				count: r.count as number
			}));
	}

	/** The display name of one list, or undefined if it no longer exists. */
	name(id: number): string | undefined {
		const row = this.db.selectValue('SELECT name FROM lists WHERE id = ?', [id]);
		return row == null ? undefined : (row as string);
	}

	words(id: number): string[] {
		return this.db
			.selectObjects('SELECT word FROM list_words WHERE list_id = ? ORDER BY word', [id])
			.map((r) => r.word as string);
	}

	/** Words in the order they were saved (older lists fall back to alphabetical). */
	orderedWords(id: number): string[] {
		return this.db
			.selectObjects(
				'SELECT word FROM list_words WHERE list_id = ? ORDER BY position IS NULL, position, word',
				[id]
			)
			.map((r) => r.word as string);
	}

	/** Remove these words from a list; returns how many were actually removed
	 *  (words not in the list are ignored). Positions of remaining words are left
	 *  as-is, so order is preserved by the gaps. */
	removeWords(id: number, words: string[]): number {
		let removed = 0;
		words.forEach((word) => {
			this.db.exec({
				sql: 'DELETE FROM list_words WHERE list_id = ? AND word = ?',
				bind: [id, word]
			});
			removed += this.db.changes();
		});
		void persistUserData();
		return removed;
	}

	/** Give a list a new display name. */
	rename(id: number, name: string): void {
		this.db.exec({ sql: 'UPDATE lists SET name = ? WHERE id = ?', bind: [name, id] });
		void persistUserData();
	}

	remove(id: number): void {
		this.db.exec({ sql: 'DELETE FROM list_words WHERE list_id = ?', bind: [id] });
		this.db.exec({ sql: 'DELETE FROM lists WHERE id = ?', bind: [id] });
		void persistUserData();
	}
}
