// Saving a file to wherever the user keeps their downloads, in both shells. The
// Tauri webview has no download manager (the browser anchor trick is a silent
// no-op there), so under Tauri we ask for a path natively and write it ourselves;
// in a plain browser we use the object-URL + anchor download. One helper so every
// export — word lists, progress backups, tile sets — behaves the same.

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** A file-type filter for the native save dialog, e.g. { name: 'Text', extensions: ['txt'] }. */
export interface SaveFilter {
	name: string;
	extensions: string[];
}

export async function saveTextFile(
	filename: string,
	text: string,
	filter?: SaveFilter
): Promise<void> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeTextFile } = await import('@tauri-apps/plugin-fs');
		const path = await save({ defaultPath: filename, filters: filter ? [filter] : undefined });
		if (path) await writeTextFile(path, text);
		return;
	}
	triggerDownload(filename, new Blob([text], { type: 'text/plain' }));
}

export async function saveBinaryFile(
	filename: string,
	bytes: Uint8Array,
	filter?: SaveFilter
): Promise<void> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		const path = await save({ defaultPath: filename, filters: filter ? [filter] : undefined });
		if (path) await writeFile(path, bytes);
		return;
	}
	// The caller's bytes are ArrayBuffer-backed, so this cast into Blob is safe.
	triggerDownload(
		filename,
		new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })
	);
}

function triggerDownload(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	// Firefox needs the anchor in the DOM for a programmatic click, and the object
	// URL must outlive the click (revoking synchronously cancels the download), so
	// tidy up on the next tick.
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
