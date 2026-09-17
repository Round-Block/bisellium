/** `npm run snapshot -- <bisellium-dir> [--now <iso>]` — print what Bisellium would see. */
import { createBiselliumAdapter, snapshotDir } from "./index.js";

const args = process.argv.slice(2);
const root = args[0];
if (!root) {
  console.error("usage: snapshot <bisellium-dir> [--now <iso>]");
  process.exit(2);
}
let now: Date | undefined;
const nowIdx = args.indexOf("--now");
if (nowIdx !== -1) {
  const v = args[nowIdx + 1];
  now = v === undefined ? undefined : new Date(v);
  if (!now || Number.isNaN(now.getTime())) {
    console.error("--now must be an ISO date");
    process.exit(2);
  }
}

const adapter = createBiselliumAdapter(root);
const [lifecycle] = adapter.describeLifecycles();
const snap = now === undefined ? await adapter.snapshot() : snapshotDir(root, adapter.projectId, now);

const human = new Set(lifecycle!.gates.filter((g) => g.kind === "human").map((g) => g.id));
const needsYou = snap.opera.filter((w) =>
  Object.entries(w.probationes).some(([g, r]) => human.has(g) && r.status === "pending"),
);
const petitiones = (snap.petitiones ?? []).filter((t) => t.state === "needs_you");

console.log(`project ${adapter.projectId}`);
console.log(`  sellae ${snap.sellae.length} · items ${snap.opera.length} · collegia ${snap.collegia?.length ?? 0}`);
for (const s of lifecycle!.states) {
  const n = snap.opera.filter((w) => w.state === s.id).length;
  if (n) console.log(`  ${s.name.padEnd(10)} ${n}`);
}
console.log(`needs you: ${needsYou.length + petitiones.length}`);
for (const w of needsYou) console.log(`  gate   ${w.id} ${String(w.meta["title"])}`);
for (const t of petitiones) console.log(`  petitio    ${t.id} on ${t.opusId}: ${t.subject ?? ""}`);
console.log("aerarium:");
for (const b of snap.stipendia ?? []) {
  const pct = b.posture !== "unknown" && b.allowance.tokens ? Math.round((100 * b.burn.tokens) / b.allowance.tokens) : null;
  console.log(`  ${b.collegiumId.padEnd(12)} ${pct === null ? "—" : pct + "%"} ${b.posture}`);
}
console.log("providers:");
for (const p of snap.providers ?? []) console.log(`  ${p.id.padEnd(12)} ${p.usagePct}% ${p.status}`);
