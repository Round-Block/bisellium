/** `npm run snapshot -- <atrium-dir>` — print what Gantry would see. */
import { createAtriumAdapter } from "./index.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: snapshot <atrium-dir>");
  process.exit(2);
}
const adapter = createAtriumAdapter(root);
const [lifecycle] = adapter.describeLifecycles();
const snap = await adapter.snapshot();

const human = new Set(lifecycle!.gates.filter((g) => g.kind === "human").map((g) => g.id));
const needsYou = snap.workItems.filter((w) =>
  Object.entries(w.gateStatus).some(([g, r]) => human.has(g) && r.status === "pending"),
);
const asks = (snap.threads ?? []).filter((t) => t.state === "needs_you");

console.log(`project ${adapter.projectId}`);
console.log(`  seats ${snap.actors.length} · items ${snap.workItems.length} · departments ${snap.departments?.length ?? 0}`);
for (const s of lifecycle!.states) {
  const n = snap.workItems.filter((w) => w.state === s.id).length;
  if (n) console.log(`  ${s.name.padEnd(10)} ${n}`);
}
console.log(`needs you: ${needsYou.length + asks.length}`);
for (const w of needsYou) console.log(`  gate   ${w.id} ${String(w.meta["title"])}`);
for (const t of asks) console.log(`  ask    ${t.id} on ${t.workItemId}: ${t.subject ?? ""}`);
console.log("budgets:");
for (const b of snap.budgets ?? []) {
  const pct = b.posture !== "unknown" && b.allowance.tokens ? Math.round((100 * b.burn.tokens) / b.allowance.tokens) : null;
  console.log(`  ${b.departmentId.padEnd(12)} ${pct === null ? "—" : pct + "%"} ${b.posture}`);
}
console.log("providers:");
for (const p of snap.providers ?? []) console.log(`  ${p.id.padEnd(12)} ${p.usagePct}% ${p.status}`);
