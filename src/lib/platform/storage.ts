// App-data file storage behind one interface, so user data works in both shells
// (DESIGN.md: "PWA and Tauri desktop, both from day one"). Under Tauri it is
// real files in the app data directory (find them, back them up, copy them
// between machines); in a plain browser it is OPFS, the origin-private file
// system. Paths are relative ("euouae.sqlite3", "lexicons/custom.json");
// parent directories are created on write. If OPFS is unavailable (e.g. an
// insecure context) an in-memory map keeps the app usable for the session.

interface AppStorage {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, bytes: Uint8Array): Promise<void>;
	remove(path: string): Promise<void>;
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

async function tauriStorage(): Promise<AppStorage> {
	const fs = await import('@tauri-apps/plugin-fs');
	const opts = { baseDir: fs.BaseDirectory.AppData };
	return {
		exists: (path) => fs.exists(path, opts),
		readFile: (path) => fs.readFile(path, opts),
		writeFile: async (path, bytes) => {
			await fs.mkdir(dirOf(path), { ...opts, recursive: true }).catch(() => {});
			await fs.writeFile(path, bytes, opts);
		},
		remove: (path) => fs.remove(path, opts)
	};
}

function opfsStorage(root: FileSystemDirectoryHandle): AppStorage {
	async function dirFor(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
		let dir = root;
		for (const seg of path.split('/').slice(0, -1)) {
			dir = await dir.getDirectoryHandle(seg, { create });
		}
		return dir;
	}
	const nameOf = (path: string) => path.split('/').at(-1)!;
	return {
		async exists(path) {
			try {
				await (await dirFor(path, false)).getFileHandle(nameOf(path));
				return true;
			} catch {
				return false;
			}
		},
		async readFile(path) {
			const handle = await (await dirFor(path, false)).getFileHandle(nameOf(path));
			return new Uint8Array(await (await handle.getFile()).arrayBuffer());
		},
		async writeFile(path, bytes) {
			const handle = await (await dirFor(path, true)).getFileHandle(nameOf(path), { create: true });
			const writable = await handle.createWritable();
			await writable.write(bytes as Uint8Array<ArrayBuffer>);
			await writable.close();
		},
		async remove(path) {
			await (await dirFor(path, false)).removeEntry(nameOf(path));
		}
	};
}

/** Session-only fallback so the app still runs where nothing persists. */
function memoryStorage(): AppStorage {
	const files = new Map<string, Uint8Array>();
	return {
		exists: async (path) => files.has(path),
		readFile: async (path) => {
			const bytes = files.get(path);
			if (!bytes) throw new Error(`No such file: ${path}`);
			return bytes;
		},
		writeFile: async (path, bytes) => void files.set(path, bytes),
		remove: async (path) => void files.delete(path)
	};
}

let storagePromise: Promise<AppStorage> | undefined;

export function appStorage(): Promise<AppStorage> {
	storagePromise ??= (async () => {
		if (isTauri()) return tauriStorage();
		try {
			return opfsStorage(await navigator.storage.getDirectory());
		} catch {
			return memoryStorage();
		}
	})();
	return storagePromise;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function readTextFile(path: string): Promise<string> {
	return decoder.decode(await (await appStorage()).readFile(path));
}

export async function writeTextFile(path: string, text: string): Promise<void> {
	await (await appStorage()).writeFile(path, encoder.encode(text));
}

export async function exists(path: string): Promise<boolean> {
	return (await appStorage()).exists(path);
}

export async function readFile(path: string): Promise<Uint8Array> {
	return (await appStorage()).readFile(path);
}

export async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
	await (await appStorage()).writeFile(path, bytes);
}

export async function removeFile(path: string): Promise<void> {
	await (await appStorage()).remove(path);
}
