# @bisellium/web

The officina's console: React + Vite, built to `apps/web/dist` and served by
`bisellium serve` at localhost. Its look is fixed by
[docs/design/DIRECTION.md](../../docs/design/DIRECTION.md); the colours and
type live in `src/tokens.css`, never here.

## Live screens

The rail's table is `src/lib/nav.ts`; each screen is in `src/screens/`.

- Inbox (`#/inbox`, the default): the petitiones waiting on a human, answered in place.
- Board (`#/board`): the opera by lifecycle state, with a drawer per opus.
- Seats (`#/seats`): the delegation tiers and the seat roster, each changed in place.
- Officina (`#/officina`): completion, posture and burn, pending actions and contract integrity.

## The two suites

- Unit: `npm test` from the repo root runs the node:test files under
  `apps/web/test/` and `apps/web/src/lib/` with the rest of the repo's. One
  file: `node --test-reporter=tap --import tsx apps/web/src/lib/nav-source.test.ts`
  (a file that imports CSS also takes
  `--import ./test/support/register-css-stub.mjs`, run from `apps/web`).
- Served: `npm run test:serve --workspace @bisellium/web` builds the bundle,
  starts a real `bisellium serve` on a temp copy of `examples/sample-studio`
  per spec and drives `tests-serve/` in Chromium
  (`npx playwright install chromium` once).
