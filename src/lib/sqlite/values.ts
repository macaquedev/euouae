// Typed coercions for raw SQLite column values. The driver hands back a loose
// SqlValue union; these give every row-mapper one consistent, safe way to read
// a column as a number, string, nullable number, or boolean.

import type { SqlValue } from '@sqlite.org/sqlite-wasm';

export const num = (v: SqlValue): number => v as number;
export const str = (v: SqlValue): string => (v as string) ?? '';
export const numOrNull = (v: SqlValue): number | null => (v == null ? null : (v as number));
export const bool = (v: SqlValue): boolean => Boolean(v);
