---
author: "sec-lead"
kind: consultation
title: "W-070 pre-spec threat model: the console under tailnet exposure"
at: "2026-09-25T13:30:00.000Z"
evidence:
  - { label: w057, href: briefs/W-057.md }
---

sec-lead's first dispatch under D-026. Ten findings; the ship-gate split
binds W-070's spec: six CLOSED-BEFORE-SHIP, three ACCEPTED-WITH-DECISION
(each needs a Patron decision id before W-070 merges), one out of scope.

1. **High — CLOSED BEFORE SHIP — The trust boundary changes from one host to every policy-authorized tailnet identity**

   Trust-boundary diagram in prose:

   ```text
   Today
   remote/LAN/tailnet ──X──> 127.0.0.1:4477
   same-host browser/process ──> Node server
                                ├─ GET/static/SSE: no application auth
                                └─ write: Origin gate + bearer token

   With W-070
   tailnet user/device
       ──WireGuard──> tailnet ACL/grant
       ──HTTPS──> Tailscale Serve proxy
       ──HTTP──> 127.0.0.1:4477
                  ├─ GET/static/SSE: currently no application auth
                  └─ write: tailnet Origin + bearer token

   same-host process ──────────> 127.0.0.1:4477 directly
   public internet ──X──> only while Serve remains private and Funnel is absent
   ```

   Today the kernel enforces the first boundary by binding only to loopback ([http.ts:1-6](</home/edckt/projects/bisellium/apps/server/src/http.ts:1>), [http.ts:870-877](</home/edckt/projects/bisellium/apps/server/src/http.ts:870>)). With Serve, the backend should remain loopback-only, but Tailscale becomes a security proxy: TLS terminates there, the backend sees a local proxy connection, and access is determined by tailnet ACLs/grants. Serve access can also include externally shared users, not merely the Patron’s own devices. [Tailscale documents both properties](https://tailscale.com/docs/features/tailscale-serve).

   W-070 currently contains only front matter ([W-070.md:1-8](</home/edckt/projects/bisellium/studio/opera/W-070.md:1>)). The current DIRECTION document contains no remote, Tailscale, or PWA section; its relevant text is the general authority model ([DIRECTION.md:280-301](</home/edckt/projects/bisellium/docs/design/DIRECTION.md:280>)). D-023 is therefore the only binding remote-access contract ([D-023.md:44-52](</home/edckt/projects/bisellium/studio/decisions/D-023.md:44>)).

   **Gate:** specify and demonstrate a Patron-only ACL/grant—or an equivalent application check of trusted Tailscale identity/app-capability headers. Preserve the `127.0.0.1` bind. “Member of the tailnet” must not silently mean “authorized Patron.”

2. **Critical — CLOSED BEFORE SHIP — A Serve-to-Funnel configuration change would publish every read route**

   D-023 expressly refuses Funnel and all public exposure ([D-023.md:47-51](</home/edckt/projects/bisellium/studio/decisions/D-023.md:47>)). This is critical because only the named POST routes pass through `checkWriteAuth`; the GET surface follows with no application authentication ([http.ts:573-586](</home/edckt/projects/bisellium/apps/server/src/http.ts:573>)).

   Tailscale states that Serve is tailnet-private, Funnel is public, and configuring the same port most recently with Funnel makes it public ([Serve limitations](https://tailscale.com/docs/features/tailscale-serve), [Funnel behavior](https://tailscale.com/kb/1223/funnel)).

   **Gate:** W-070 needs enforceable Serve-only configuration and acceptance evidence showing the active endpoint is not Funnel. A prose warning is insufficient under the officina’s standing enforcement rule. Prefer a launcher/preflight or check rule that inspects effective Tailscale configuration and fails closed.

3. **High — CLOSED BEFORE SHIP — The remote read surface is substantially more sensitive than `/health` and `/officina`**

   All of these are unauthenticated at the application layer:

   - `/api/officina` discloses the studio, Patron, collegia, seats, autonomy, model, tier, munus, and lifecycle records ([store.ts:220-257](</home/edckt/projects/bisellium/apps/server/src/store.ts:220>)).
   - `/api/health` exposes rule counts, autonomy pause state/reason, and due-state information ([store.ts:343-375](</home/edckt/projects/bisellium/apps/server/src/store.ts:343>)).
   - `/api/opus/:id` returns the full front matter and body ([store.ts:278-293](</home/edckt/projects/bisellium/apps/server/src/store.ts:278>)).
   - `/api/inbox` returns pending petition subjects and bodies ([store.ts:299-311](</home/edckt/projects/bisellium/apps/server/src/store.ts:299>)).
   - Timelines, raw events, and receipts are also readable ([store.ts:378-415](</home/edckt/projects/bisellium/apps/server/src/store.ts:378>), [store.ts:417-453](</home/edckt/projects/bisellium/apps/server/src/store.ts:417>)).

   Consequently, health/officina are useful reconnaissance, but they are not the worst disclosure. A tailnet principal can enumerate the organization, identify active work and human gates, then read detailed records and activity.

   **Gate:** define a read-access policy. The smallest design consistent with D-023 is a Patron-only Tailscale grant protecting the entire Serve endpoint. If broader tailnet read access is intended, that exposure requires a recorded decision naming the accepted data classes.

4. **High — ACCEPTED-WITH-DECISION — The token is an intentionally replayable bearer credential**

   Guessing is not the credible attack: the token is generated from 24 random bytes ([http.ts:814](</home/edckt/projects/bisellium/apps/server/src/http.ts:814>)) and compared with `timingSafeEqual` ([http.ts:323-332](</home/edckt/projects/bisellium/apps/server/src/http.ts:323>)). Theft and replay are.

   The credential is printed to stdout ([serve.ts:119-123](</home/edckt/projects/bisellium/packages/cli/src/serve.ts:119>)), stored in `sessionStorage` ([api.ts:32-55](</home/edckt/projects/bisellium/apps/web/src/api.ts:32>)), and attached to every browser write ([api.ts:185-195](</home/edckt/projects/bisellium/apps/web/src/api.ts:185>)). A same-origin script, malicious extension, compromised browser profile, terminal log, or screen-sharing capture can obtain it. Once stolen, a non-browser client can omit `Origin` entirely; that is explicitly accepted, leaving the token as the sole authorization control ([http.ts:347-365](</home/edckt/projects/bisellium/apps/server/src/http.ts:347>)).

   Impact is high: several routes execute with Patron identity ([http.ts:239-251](</home/edckt/projects/bisellium/apps/server/src/http.ts:239>)), while `/api/talk` can initiate a minutes-long harness turn ([http.ts:743-760](</home/edckt/projects/bisellium/apps/server/src/http.ts:743>)).

   **Recommendation:** retain the D-023 bearer-token decision, but record that it is replayable and not bound to a Tailscale identity. Define secure transfer to the remote device, restart-based revocation/rotation, terminal-log handling, and a visible “forget token” action. Do not put it in a URL, manifest, service-worker cache, or cookie.

5. **Medium — CLOSED BEFORE SHIP — CSRF is currently controlled, but the proxy-origin change can regress it**

   Traditional cross-site browser writes presently require defeating three independent checks: exact `Origin`, the non-cookie token header, and JSON content type ([http.ts:347-368](</home/edckt/projects/bisellium/apps/server/src/http.ts:347>)). A PWA manifest does not itself weaken the same-origin policy.

   The current accepted-origin type is exactly a two-element loopback tuple, derived from the backend’s bound HTTP port ([http.ts:334-345](</home/edckt/projects/bisellium/apps/server/src/http.ts:334>)). That silently assumes the browser-facing scheme, host, and port equal the backend socket. Serve breaks all three: the browser sees an HTTPS tailnet hostname while Node remains on loopback HTTP. Current documentation even states that reverse proxies are unsupported ([ADOPTION.md:881-897](</home/edckt/projects/bisellium/docs/ADOPTION.md:881>)).

   **Gate:** accept one explicitly configured, canonical HTTPS tailnet origin in addition to the loopback origins. Never derive it from request `Host`, `Forwarded`, or `X-Forwarded-*`; those remain attacker-controlled at the backend boundary. Tests must cover the exact tailnet origin, another tailnet hostname, HTTP downgrade, wrong port, `null`, foreign Origin, spoofed Host/forwarded headers, and missing/wrong token.

6. **Medium — CLOSED BEFORE SHIP — `/api/live` is an unauthenticated subscription and shared exhaustion pool**

   `/api/live` bypasses write authentication entirely ([http.ts:663-666](</home/edckt/projects/bisellium/apps/server/src/http.ts:663>)). It broadcasts every newly ingested event to every connected client ([http.ts:474-494](</home/edckt/projects/bisellium/apps/server/src/http.ts:474>)), with one global pool capped at 50 connections ([http.ts:497-509](</home/edckt/projects/bisellium/apps/server/src/http.ts:497>)). The web client supplies neither token nor identity ([api.ts:296-319](</home/edckt/projects/bisellium/apps/web/src/api.ts:296>)).

   Any permitted tailnet client can therefore subscribe directly or occupy all slots. Browser SOP normally prevents a foreign page from reading the stream, but the server performs no Origin check before allocating a slot; induced cross-origin connections remain a DoS concern.

   **Gate:** apply the chosen read-access boundary to SSE and reject a present foreign Origin before allocating a slot. Do not solve this with a token query parameter. If identity-based per-client limits are desired, use a trusted Serve identity/app-capability header or another proxy-authenticated identity, not the backend socket address.

7. **Medium — ACCEPTED-WITH-DECISION — “PWA shell” does not yet define a persistence boundary**

   No manifest or service worker exists in the current web tree. W-070 and D-023 specifically say “PWA manifest” ([W-070.md:3](</home/edckt/projects/bisellium/studio/opera/W-070.md:3>), [D-023.md:52](</home/edckt/projects/bisellium/studio/decisions/D-023.md:52>)). The JSON responder currently sets only `Content-Type`, not `Cache-Control: no-store` ([http.ts:105-108](</home/edckt/projects/bisellium/apps/server/src/http.ts:105>)); only SSE explicitly sends `no-cache` ([http.ts:503-507](</home/edckt/projects/bisellium/apps/server/src/http.ts:503>)).

   **Recommendation:** record W-070 as manifest/installability only, with no service worker or offline API cache. If a service worker is included, this finding becomes **CLOSED BEFORE SHIP**: it needs its own threat model covering stale authorization, cached officina data, logout/revocation, update integrity, and exclusion of token-bearing requests. Sensitive API responses should use `Cache-Control: no-store`.

8. **High — CLOSED BEFORE SHIP — W-057 is a hard dependency and is not yet present in the measured code**

   The current tree still returns arbitrary exception messages in 500 responses ([http.ts:120-124](</home/edckt/projects/bisellium/apps/server/src/http.ts:120>)) and request-stream/parse messages in 400 responses ([http.ts:155-184](</home/edckt/projects/bisellium/apps/server/src/http.ts:155>)). Under tailnet exposure those messages can reveal paths, refs, parser details, or proxy/socket errors.

   W-057 correctly covers:

   - Constant 500 bodies with correlation IDs and details moved to stderr ([W-057.md:84-126](</home/edckt/projects/bisellium/studio/briefs/W-057.md:84>)).
   - Both caught-value sinks, including request-stream failures ([W-057.md:47-79](</home/edckt/projects/bisellium/studio/briefs/W-057.md:47>)).
   - Closed error codes, regression coverage, and GHAS alert 3 actually reaching `fixed` ([W-057.md:382-399](</home/edckt/projects/bisellium/studio/briefs/W-057.md:382>)).
   - An explicit ordering that W-070 waits for W-057 ([W-057.md:401-408](</home/edckt/projects/bisellium/studio/briefs/W-057.md:401>)).

   W-057 does **not** cover token theft/replay, tailnet ACLs, remote-origin configuration, successful read-body disclosure, SSE authorization/exhaustion, PWA caching, general rate limiting, or Funnel drift. Rate limiting and other GHAS classes are expressly out of scope ([W-057.md:423-433](</home/edckt/projects/bisellium/studio/briefs/W-057.md:423>)).

   **Gate:** W-057 must land first; alert 3 must have a recorded `fixed_at`; no replacement stack-trace alert may exist; then W-070 can expose the console.

9. **Medium — ACCEPTED-WITH-DECISION — Unauthenticated reads can trigger nontrivial server work**

   `/api/models` invokes a vendor-listing operation, albeit TTL-cached and timed out ([http.ts:254-287](</home/edckt/projects/bisellium/apps/server/src/http.ts:254>), [http.ts:593-596](</home/edckt/projects/bisellium/apps/server/src/http.ts:593>)). `/api/providers?live=1` selects live provider status ([http.ts:626-629](</home/edckt/projects/bisellium/apps/server/src/http.ts:626>), [store.ts:338-341](</home/edckt/projects/bisellium/apps/server/src/store.ts:338>)). `/api/health` can run a fresh full studio check when no usable health file exists ([store.ts:343-359](</home/edckt/projects/bisellium/apps/server/src/store.ts:343>)).

   **Recommendation:** accept this residual only with the Patron-only access boundary from finding 1. If broader tailnet access is permitted, add caching/rate controls before shipping.

10. **Informational — OUT OF SCOPE — Endpoint or control-plane compromise**

   Compromise of the server host, the Patron’s browser/extension environment, a permitted Patron device, Tailscale account/control plane, or WireGuard node keys defeats assumptions below this design. Tailscale cryptographically authenticates nodes, but endpoint security remains external to W-070 ([Tailscale identity and connection security](https://tailscale.com/docs/concepts/tailscale-identity)).

   This does not excuse bearer-token hygiene or least-privilege ACLs; it only marks the point beyond which W-070 cannot provide meaningful isolation.
