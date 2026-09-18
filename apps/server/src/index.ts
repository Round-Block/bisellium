/**
 * @bisellium/server — the localhost HTTP + SSE surface over a Bisellium
 * studio (W-014). `packages/cli/src/serve.ts` is the CLI's thin argv
 * wrapper around `startServer` below.
 */
export { Store, type StoreOptions } from "./store.js";
export { startServer, isPathContained, type StartServerOptions, type StartServerResult } from "./http.js";
