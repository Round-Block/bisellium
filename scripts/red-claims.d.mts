/** W-462: the declarations `packages/cli` imports red-claims.mjs through; the module is the certify runner's own. */
export interface RedClaim {
  behaviour: number;
  commandText: string;
  claimedTree: string;
  commit: string;
  titles: string[] | undefined;
}
export function redClaimer(o: {
  finalCommit: string;
  logRel: string;
  behaviours: number;
  sourceTree: (commit: string) => string;
  git: (args: string[], input?: string) => { status: number | null; stdout: string };
  mustGit: (args: string[]) => string;
}): (name: string, log: Buffer) => RedClaim;
