/**
 * @bisellium/shim — logs and receipts hygiene. Best-effort masking of
 * secret-shaped substrings before they land in a run receipt (receipts.ts)
 * or a `bisellium verify` ci/*.log (packages/pipeline): `token=`, `key=`,
 * `secret=`, `password=` (case-insensitive, any of those names followed by
 * `=`), `Bearer <token>` headers, and any standalone 32+ character hex or
 * base64-ish run (API keys, session tokens, hashes that happen to carry a
 * secret rather than an identity we need to keep, e.g. don't call this on a
 * git tree hash you need a reader to see).
 */
const KV = /\b(token|key|secret|password)=([^\s"'&]+)/gi;
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi;
const LONG_RUN = /\b[A-Za-z0-9+/_-]{32,}\b/g;

export function redact(text: string): string {
  let out = text.replace(KV, (_m, name: string) => `${name}=***`);
  out = out.replace(BEARER, () => "Bearer ***");
  out = out.replace(LONG_RUN, (m) => "*".repeat(Math.min(m.length, 8)));
  return out;
}

/** Env var names allowed through the filter even though the value could be
 *  anything — needed for the child process to run at all. Everything else
 *  matching /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i is dropped. */
const ALLOWLIST = /^(PATH|HOME|NODE_.*|LANG|TZ)$/;
const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i;

/** A copy of `env` with any secret-shaped variable name dropped, unless it's
 *  on the allowlist (PATH, HOME, NODE_*, LANG, TZ). Used to run untrusted
 *  probatio commands without handing them the parent process's credentials. */
export function filterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_NAME.test(k) && !ALLOWLIST.test(k)) continue;
    out[k] = v;
  }
  return out;
}
