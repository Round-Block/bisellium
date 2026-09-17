/** `npm run snapshot -- <bisellium-dir>` — print what Bisellium would see. */
import { createBiselliumAdapter } from "./index.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: snapshot <bisellium-dir>");
  process.exit(2);
}
const adapter = createBiselliumAdapter(root);
const [lifecycle] = adapter.describeLifecycles();
const snap = await adapter.snapshot();

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
