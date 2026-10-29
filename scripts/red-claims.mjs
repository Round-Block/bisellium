/**
 * Host-owned W-134 red-to-commit mapping, the certify runner's own (scripts/run-builder-host.mjs, the tree lookup and
 * `identifyRebased`), copied into a module of its own (W-462) with its logic and refusal lines unchanged, so the `pr` rung's rewrite check
 * (packages/cli/src/rewrite.ts) maps a recorded red to the commit certify replays it at. The runner keeps its inline copy
 * until it imports this module, a change to certify's host runner that is split out and lands first (W-323, D-129 B).
 * Pure but for the git and source-tree reads the caller hands in; no fs, no spawn.
 *
 * A red log is a claim: its `# tree:` names the SOURCE tree it was recorded at, and the commit it is replayed at is the
 * last commit of the branch's history with that source tree. A claim that matches no commit (a rebase moved the hash) is
 * re-identified by the log's own commit: the unique commit that introduced the log's exact bytes at its path and carries
 * no source of its own. Zero, several or a source-carrying commit refuses; there is no nearest or newest tiebreak.
 */
import { createHash } from "node:crypto";
import { readRedBehaviour } from "./replay-accept.mjs";

/**
 * `finalCommit`: the branch head whose history is searched. `logRel`: the reds directory, repository-relative
 * (`<studio>/ci/reds/<opus>`). `behaviours`: the brief's count. `sourceTree(commit)`: the commit's source-tree hash (hex).
 * `git(args, input?)`: a spawnSync-shaped result; `mustGit(args)`: trimmed stdout, or a throw.
 * Returns `claim(name, bytes)`: `{ behaviour, commandText, claimedTree, commit, titles }` (`titles` only after a
 * re-identification), or throws certify's own refusal.
 */
export function redClaimer({ finalCommit, logRel, behaviours, sourceTree, git, mustGit }) {
  const history = mustGit(["rev-list", "--reverse", finalCommit]).split("\n").filter(Boolean);
  const sourceCommits = new Map(history.map((commit) => [`tree:${sourceTree(commit)}`, commit]));
  const seen = new Set();
  const identifyRebased = (name, behaviour, log, text) => {
    const refuse = (why) => new Error(`producer red replay refused ${name}: behaviour ${behaviour}: ${why}`);
    const blob = createHash("sha1").update(`blob ${log.length}\0`).update(log).digest("hex");
    const parentOf = new Map(
      mustGit(["rev-list", "--parents", finalCommit])
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" ")),
    );
    const at = `${logRel}/${name}`;
    const commits = [...parentOf.keys()];
    const shown = git(["cat-file", "--batch-check"], commits.map((c) => `${c}:${at}\n`).join(""));
    if (shown.status !== 0) throw refuse("the branch's history could not be read");
    const answers = shown.stdout.split("\n");
    const blobAt = new Map(commits.map((c, i) => [c, answers[i].split(" ")[0]]));
    const introduced = commits.filter((c) => blobAt.get(c) === blob && blobAt.get(parentOf.get(c)) !== blob);
    if (introduced.length === 0) throw refuse("no commit on the branch introduced its recorded bytes");
    if (introduced.length > 1) throw refuse(`${introduced.length} commits introduced its recorded bytes`);
    const [commit] = introduced;
    const parent = parentOf.get(commit);
    if (parent === undefined || sourceTree(commit) !== sourceTree(parent))
      throw refuse(`identifying commit ${commit} carries source`);
    const titles = [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].replace(/\r$/, ""));
    if (titles.length === 0) throw refuse("its recorded log has no not-ok title to re-attest");
    return { commit, titles };
  };
  return (name, log) => {
    const text = log.toString("utf8");
    const behaviour = readRedBehaviour(text, name);
    const commandText = text.match(/^# command:\s*(.+)$/m)?.[1];
    const claimedTree = text.match(/^# tree:\s*(tree:[0-9a-f]{40})$/m)?.[1];
    let commit = claimedTree ? sourceCommits.get(claimedTree) : undefined;
    if (behaviour === undefined || behaviour > behaviours || seen.has(behaviour))
      throw new Error(`producer red replay refused ${name}: behaviour header does not match a declared behaviour`);
    seen.add(behaviour);
    if (!commandText || !claimedTree) throw new Error(`producer red replay refused malformed/unreachable ${name}`);
    let titles;
    if (commit === undefined) ({ commit, titles } = identifyRebased(name, behaviour, log, text));
    return { behaviour, commandText, claimedTree, commit, titles };
  };
}
