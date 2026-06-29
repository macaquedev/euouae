// The app is a fully client-side SPA: the lexicon and all user data live in the
// browser (wa-sqlite over OPFS), so there is nothing to render on a server and
// nothing to prerender at build time. Everything runs in the client.
export const ssr = false;
export const prerender = false;
export const csr = true;
