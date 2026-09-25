/**
 * apps/web/test/support/css-stub-hook.mjs — W-064 test scaffolding (lex §2:
 * decided alone, no red). `tsx` has no CSS loader (see Sidebar.tsx's own
 * comment); `GateLadder.tsx` is reused unchanged (not this opus's file) and
 * unconditionally does `import "./w025.css"`. Rendering the real component
 * under plain node (behaviour 5's byte-identity + import-reuse proof) needs
 * that import to resolve to something rather than crash with
 * ERR_UNKNOWN_FILE_EXTENSION. This hook makes any `.css` specifier resolve
 * to an empty module — it changes nothing about what ships (Vite handles
 * real CSS in the browser bundle; this only runs inside `node --import`).
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default undefined;", shortCircuit: true };
  }
  return nextLoad(url, context);
}
