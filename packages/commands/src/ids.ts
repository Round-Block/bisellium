/**
 * Shared sequential-record allocator.  The filename is the id claim: find
 * the highest matching filename in this checkout and every locally-known
 * branch/ref, then reserve the next candidate with an exclusive create.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type RecordDirectory = "opera" | "petitiones" | "lessons";
export type RecordPrefix = "W" | "P" | "L";

export interface CreatedRecord {
  id: string;
  path: string;
}

const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;

function numericSuffix(name: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(name);
  return match ? Number(match[1]) : undefined;
}

function localMaximum(directoryPath: string, pattern: RegExp): number {
  let maximum = 0;
  for (const name of readdirSync(directoryPath)) {
    const suffix = numericSuffix(name, pattern);
    if (suffix !== undefined) maximum = Math.max(maximum, suffix);
  }
  return maximum;
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Returns the ref-wide maximum, or `undefined` after any Git failure.  The
 * result is all-or-nothing so a failed tree read cannot leave a misleading
 * partial maximum in use.
 */
function refMaximum(studioRoot: string, directory: RecordDirectory, pattern: RegExp): number | undefined {
  try {
    const physicalStudio = realpathSync(studioRoot);
    const discoveredRoot = gitOutput(physicalStudio, ["rev-parse", "--show-toplevel"]).trim();
    const physicalRepo = realpathSync(discoveredRoot);
    const studioRelative = relative(physicalRepo, physicalStudio);
    if (studioRelative === ".." || studioRelative.startsWith(`..${sep}`)) throw new Error("officina is outside its Git worktree");

    const gitDirectory = [...(studioRelative ? studioRelative.split(sep) : []), directory].join("/");
    const refs = gitOutput(physicalRepo, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ])
      .split(/\r?\n/)
      .filter((ref) => ref.length > 0);

    let maximum = 0;
    for (const ref of refs) {
      const paths = gitOutput(physicalRepo, ["ls-tree", "-r", "-z", "--name-only", ref, "--", gitDirectory]).split(
        /\0|\r?\n/,
      );
      const directoryPrefix = `${gitDirectory}/`;
      for (const path of paths) {
        if (!path.startsWith(directoryPrefix)) continue;
        const name = path.slice(directoryPrefix.length);
        if (name.includes("/")) continue;
        const suffix = numericSuffix(name, pattern);
        if (suffix !== undefined) maximum = Math.max(maximum, suffix);
      }
    }
    return maximum;
  } catch {
    return undefined;
  }
}

export function createNextRecord(
  studioRoot: string,
  directory: RecordDirectory,
  prefix: RecordPrefix,
  render: (id: string) => string | Uint8Array,
): CreatedRecord {
  const directoryPath = join(studioRoot, directory);
  mkdirSync(directoryPath, { recursive: true });
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.md$`);
  const local = localMaximum(directoryPath, pattern);
  const fromRefs = refMaximum(studioRoot, directory, pattern);
  if (fromRefs === undefined) {
    console.error("warning: Git ref-wide allocation unavailable; using local records only");
  }

  let candidate = Math.max(local, fromRefs ?? 0) + 1;
  for (;;) {
    const id = `${prefix}-${String(candidate).padStart(3, "0")}`;
    const path = join(directoryPath, `${id}.md`);
    try {
      writeFileSync(path, render(id), { flag: "wx" });
      return { id, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      candidate++;
    }
  }
}
