/**
 * packages/cli/src/rules/receipts.ts — W-666: the `patron.receipt` rule. A Patron answer's committed record is the petitio's
 * stamp line, `[stated] <instant> <patron>: <reply>`, and its proof is the receipt the petitio's front matter records under
 * that instant (`receipts`). In an officina whose bisellium.yml names Patron keys (`patron_receipts.keys`), each stamp's
 * receipt must verify (`receiptProblem`, @bisellium/commands/patron-receipt.js): a Patron key, a signature over exactly the
 * petitio, the question as it stood before the stamp and the stamped reply, a nonce spent once across the officina, a
 * time within the window before the stamp. A stamp with no receipt is unsigned; the officina's unsigned stamps, listed
 * and hashed by `unsignedDigest`, must equal `patron_receipts.floor` (the answers recorded before receipts), so a new
 * unsigned stamp, or an edit to an old one, blocks. A receipt keyed by no stamp blocks. An officina naming no keys gets
 * one advisory while any petitio holds a Patron stamp. W-666 r3: with keys named, a petitio source that does not read (an
 * unlistable petitiones/, a symlinked, non-regular or unreadable entry, front matter that does not parse as a mapping,
 * `receipts` not a mapping) blocks, never is skipped, so no unread stamp escapes the rule.
 */
import { instant } from "@bisellium/schema";
import { parseReceipt, patronStamps, questionDigest, readPetitioReceipts, readReceiptPolicy, receiptProblem, unsignedDigest } from "@bisellium/commands/patron-receipt.js";
import type { Finding, RuleOpts } from "../check.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function checkReceipts(root: string, opts: RuleOpts): Finding[] {
  const out: Finding[] = [];
  const add = (level: Finding["level"], where: string, message: string): void => void out.push({ rule: "patron.receipt", level, where, message });
  const policy = readReceiptPolicy(opts.manifest);
  if (policy !== undefined && "error" in policy) {
    add("block", "bisellium.yml", policy.error);
    return out;
  }
  const declared = (opts.manifest as Record<string, unknown> | undefined)?.["patron"];
  const patronId = typeof declared === "string" && declared.trim() !== "" ? declared : "patron";
  const read = readPetitioReceipts(root);
  const unsigned: { where: string; at: string; reply: string }[] = [];
  const spent = new Set<string>();
  if (policy !== undefined) for (const p of read.problems) add("block", p.where, p.message);
  for (const { where, id, body, receipts } of read.records) {
    const stamps = patronStamps(body, patronId, receipts);
    if (policy === undefined) {
      unsigned.push(...stamps.map((s) => ({ where, at: s.at, reply: s.reply })));
      continue;
    }
    for (const stamp of stamps) {
      const raw = receipts.get(stamp.at);
      if (raw === undefined) {
        unsigned.push({ where, at: stamp.at, reply: stamp.reply });
        continue;
      }
      const receipt = parseReceipt(raw);
      if ("error" in receipt) {
        add("block", where, `stamp ${stamp.at}: ${receipt.error}`);
        continue;
      }
      const stampedAt = ISO.test(stamp.at) ? instant(stamp.at) : undefined;
      if (stampedAt === undefined) {
        add("block", where, `stamp ${stamp.at}: the stamp's instant is not an ISO time`);
        continue;
      }
      const facts = { petitio: id, question: questionDigest(body.slice(0, stamp.index)), option: stamp.reply, mode: receipt.payload.mode, charter_gap: receipt.payload.charter_gap };
      const problem = receiptProblem(receipt, policy, facts, stampedAt, spent);
      if (problem !== undefined) add("block", where, `stamp ${stamp.at}: ${problem}`);
      else spent.add(receipt.payload.nonce);
      // W-666 r5: a signed stamp spans exactly its option; any text after it but the next stamp is an unsigned addition
      if (stamp.suffix !== "") add("block", where, `stamp ${stamp.at}: text after the signed reply: ${JSON.stringify(stamp.suffix.slice(0, 80))}`);
    }
    const stamped = new Set(stamps.map((s) => s.at));
    for (const at of receipts.keys()) if (!stamped.has(at)) add("block", where, `the receipt recorded under ${at} answers no stamp`);
  }
  if (unsigned.length === 0) return out;
  if (policy === undefined) {
    add("advise", "bisellium.yml", `${unsigned.length} Patron stamp${unsigned.length === 1 ? "" : "s"} carry no receipt: bisellium.yml names no patron_receipts keys`);
    return out;
  }
  const digest = unsignedDigest(unsigned, patronId);
  if (digest !== policy.floor)
    add("block", "bisellium.yml", `${unsigned.length} Patron stamp${unsigned.length === 1 ? "" : "s"} carry no receipt and are not the floor: their sha256 ${digest} is not patron_receipts.floor`);
  return out;
}
