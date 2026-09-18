/**
 * scripts/changelog.test.mjs — behaviours 4 and 5 of the W-019 brief:
 * `groupByCascade` splits a fixture log correctly, and the script itself is
 * deterministic and writes nothing outside CHANGELOG.md. No framework, same
 * house style as packages/cli/src/*.test.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupByCascade } from "./changelog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "changelog.mjs");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// behaviour 4: groupByCascade splits a fixture log, reverse-chronological,
// later non-cascade commits under Unreleased.
// ---------------------------------------------------------------------------
{
  const fixture = [
    "docs: newest, no cascade label yet", // newest
    "fix: typo",
    "Cascade 2: server hardening",
    "cli: follow-up inside cascade 2",
    "Cascade 1: init and new",
    "chore: repo scaffold", // oldest
  ];
  const groups = groupByCascade(fixture);

  check(
    "groups.length === 3 (Unreleased, Cascade 2, Cascade 1)",
    groups.length === 3,
    JSON.stringify(groups.map((g) => g.cascade)),
  );

  const [unreleased, c2, c1] = groups;
  check("group 0 is Unreleased", unreleased?.cascade === "Unreleased");
  check(
    "Unreleased holds the two commits before any Cascade N line",
    JSON.stringify(unreleased?.commits) === JSON.stringify(fixture.slice(0, 2)),
    JSON.stringify(unreleased?.commits),
  );

  check("group 1 is Cascade 2", c2?.cascade === "2");
  check(
    "Cascade 2 holds its own label plus the follow-up commit, in order",
    JSON.stringify(c2?.commits) === JSON.stringify(fixture.slice(2, 4)),
    JSON.stringify(c2?.commits),
  );

  check("group 2 is Cascade 1", c1?.cascade === "1");
  check(
    "Cascade 1 holds its label plus the oldest commit",
    JSON.stringify(c1?.commits) === JSON.stringify(fixture.slice(4, 6)),
    JSON.stringify(c1?.commits),
  );

  // reverse-chronological: newest group first
  check("reverse-chronological order", groups.map((g) => g.cascade).join(",") === "Unreleased,2,1");
}

// ---------------------------------------------------------------------------
// behaviour 4b: no Cascade N line anywhere ⇒ everything under Unreleased.
// ---------------------------------------------------------------------------
{
  const fixture = ["c: third", "b: second", "a: first"];
  const groups = groupByCascade(fixture);
  check("no-cascade-label fixture: one group, Unreleased", groups.length === 1 && groups[0]?.cascade === "Unreleased");
  check("no-cascade-label fixture: holds every commit", JSON.stringify(groups[0]?.commits) === JSON.stringify(fixture));
}

// ---------------------------------------------------------------------------
// behaviour 5: scripts/changelog.mjs is deterministic on a fixture git log
// and writes nothing outside CHANGELOG.md.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-changelog-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "chore: repo scaffold",
      ],
      {
        cwd: dir,
      },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "Cascade 1: init and new",
      ],
      {
        cwd: dir,
      },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "fix: unrelated tweak",
      ],
      {
        cwd: dir,
      },
    );
    writeFileSync(join(dir, "untouched.txt"), "leave me alone\n");
    execFileSync("git", ["add", "untouched.txt"], { cwd: dir });
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "add: a bystander file"],
      { cwd: dir },
    );

    execFileSync(process.execPath, [SCRIPT, dir]);
    check("run 1: CHANGELOG.md was written", existsSync(join(dir, "CHANGELOG.md")));
    const first = readFileSync(join(dir, "CHANGELOG.md"), "utf8");

    const statusAfterRun1 = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    const untrackedOrChanged = statusAfterRun1
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.slice(3));
    check(
      "run 1: nothing outside CHANGELOG.md touched",
      untrackedOrChanged.length === 1 && untrackedOrChanged[0] === "CHANGELOG.md",
      JSON.stringify(untrackedOrChanged),
    );

    execFileSync(process.execPath, [SCRIPT, dir]);
    const second = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    check("run 2: byte-identical to run 1 (deterministic)", first === second);

    check("CHANGELOG.md mentions the cascade label", first.includes("Cascade 1: init and new"));
    check(
      "CHANGELOG.md puts the later commit under Unreleased",
      first.includes("## Unreleased") && first.indexOf("fix: unrelated tweak") < first.indexOf("Cascade 1"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
