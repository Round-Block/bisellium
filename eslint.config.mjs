/**
 * eslint.config.js — flat config (ESLint 10). W-019: a real linter that
 * passes the tree as it stands, chosen deliberately narrow so it never
 * demands an edit in another builder's file this cascade. See the red at
 * studio/ci/ (the pre-narrowing `tseslint.configs.recommended` run) and
 * CONTRIBUTING.md for the widening plan.
 *
 * - `no-unused-vars` stays a warning, not an error: ESLint's own CLI only
 *   fails the run on errors (no `--max-warnings` set), so a real unused
 *   import in another opus's file (e.g. apps/server/src/http.ts, W-016's
 *   this cascade) is reported without blocking a build nobody but that
 *   opus's own gate can fix — `argsIgnorePattern`/`varsIgnorePattern: "^_"`
 *   still silences the many deliberately-unused `_opts` parameters the rule
 *   modules (Seam S2) share on purpose.
 * - `no-undef` off: TypeScript already checks this, and the rule doesn't
 *   understand TS types/ambient globals.
 * - `no-console` off: this is a CLI; console output is the product.
 * - `no-explicit-any` / `no-floating-promises` are left out: the tree isn't
 *   clean under the first (apps/server/test/server.test.ts) and the second
 *   needs type-aware parsing across nine per-package tsconfigs — add both
 *   once a builder owns the files that would need fixing.
 */
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules", "dist", "studio/", "examples/", "docs/", ".bisellium/", "cascades/", ".claude/"],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "off",
      "no-console": "off",
    },
  },
);
