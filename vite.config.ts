import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Pure client-side SPA: no server at runtime, so the same build serves
			// both the PWA and the Tauri shell. `fallback` makes every route resolve
			// to the SPA entry point. See src/routes/+layout.ts for ssr/prerender.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	// sqlite-wasm locates its .wasm via `new URL('sqlite3.wasm', import.meta.url)`,
	// which only resolves correctly when Vite leaves the package unbundled.
	// `svelte/animate` is reached only through the lazily-loaded Marinate route, so
	// Vite's startup scan misses it and re-optimizes on first visit — the in-flight
	// import then 504s and SvelteKit's SPA router shows a 500. Pre-bundle it so the
	// dep is ready up front and that navigation never races the optimizer.
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'], include: ['svelte/animate'] },
	// Fixed port so the Tauri shell's dev URL is stable.
	server: { port: 1420, strictPort: true }
});
