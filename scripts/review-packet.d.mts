/** W-274: the declaration `packages/cli`'s review perform imports through; the packet itself lives in review-packet.mjs (W-215). */
export function buildPacket(args: {
  phase: "spec" | "build" | "handoff";
  opus: string;
  round: number;
  sella: string;
  studio: string;
  repo: string;
  packets: string;
  /** W-314: the studio whose prompts/later-round.md is read and whose path fills `<STUDIO>` (default: `studio`'s place in the main work tree, W-315). */
  promptStudio?: string;
}): { packet: string; files: Map<string, string>; images: string[] };
/** W-274: the W-215 argument check, whose real-path test keeps `--packets` outside `--studio`; it throws on a refusal. */
export function parsePacketArgs(argv: string[]): unknown;
