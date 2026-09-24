/**
 * @bisellium/shim/harness/env.ts — W-049 (studio/briefs/W-049.md): the env
 * every vendor spawn a harness profile makes gets is the projection of the
 * parent env onto a fixed set of exact names — case-sensitive set
 * membership, no regex, no prefix, no suffix, no case folding. Everything
 * else is dropped, including every variable a vendor hasn't invented yet.
 * Not re-exported from harness/index.ts or the shim index — a caller
 * configuring this list would be the boundary this opus closes (checked by
 * review, not by a test; see the brief's "Interfaces").
 */

/** The whole list. Each name's consumer is recorded in the brief:
 *  - PATH: resolves the vendor binary, the node launchers' `env node`
 *    shebang, and seeds the vendor Bash tool's shell.
 *  - HOME: the vendor's stored login and config (~/.claude, ~/.codex).
 *  - SHELL: the vendor Bash tool's shell.
 *  - TMPDIR: vendor temp files — under the sandbox, the only writable one.
 *  - HTTPS_PROXY/https_proxy/HTTP_PROXY/http_proxy/NO_PROXY/no_proxy:
 *    transport — under the sandbox all egress goes through its filtering
 *    proxy. */
const ALLOWLIST: readonly string[] = Object.freeze(["PATH", "HOME", "SHELL", "TMPDIR", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"]);

/** Projects `parent` onto the allowlist above: a NEW object holding every
 *  listed name whose parent value is not `undefined`, copied verbatim.
 *  `parent` is never mutated. */
export function harnessEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of ALLOWLIST) {
    const value = parent[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}
