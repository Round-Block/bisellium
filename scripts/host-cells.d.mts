/** W-461: the declarations `packages/commands` imports through; host-cells.mjs is the host runner's own module, unchanged. */
export const WEB_BUILD: readonly string[];
export const WEB_BUNDLE: readonly string[];
export function prepFailure(behaviour: number, kind: "exit" | "spawn" | "bundle", status?: number | null): string;
