/** W-461: the declarations `packages/commands` imports through; host-cells.mjs is the host runner's own module, unchanged. */
export const WEB_BUILD: readonly string[];
export const WEB_BUNDLE: readonly string[];
export function prepFailure(behaviour: number, kind: "exit" | "spawn" | "bundle", status?: number | null): string;
/** W-573: certify's own browser-cache resolver, which `red`'s cell names as PLAYWRIGHT_BROWSERS_PATH. */
export function browserCache(env: Record<string, string | undefined>, home: string): string | undefined;
