/**
 * Shared sequential-record allocator.  The filename is the id claim: find
 * the highest matching filename in this checkout and every locally-known
 * branch/ref, then reserve the next candidate with an exclusive create.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type RecordDirectory = "opera" | "petitiones" | "lessons";
export type RecordPrefix = "W" | "P" | "L";

export interface CreatedRecord {
  id: string;
  path: string;
}

const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;
// Existing filenames are compared exactly; only newly minted suffixes stop here.
const MAX_SUFFIX = 999_999_999n;
// A single allocation may absorb at most 100 concurrent EEXIST collisions.
const MAX_EEXIST_RETRIES = 100;

function numericSuffix(name: string, pattern: RegExp): bigint | undefined {
  const match = pattern.exec(name);
  const digits = match?.[1];
  return digits === undefined ? undefined : BigInt(digits);
}

function localMaximum(directoryPath: string, pattern: RegExp): bigint {
  let maximum = 0n;
  for (const name of readdirSync(directoryPath)) {
    const suffix = numericSuffix(name, pattern);
    if (suffix !== undefined && suffix > maximum) maximum = suffix;
  }
  return maximum;
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      // Tree discovery must be local, literal and independent of refs/replace.
      GIT_NO_LAZY_FETCH: "1",
      GIT_LITERAL_PATHSPECS: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
    },
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function supportsSafeRefInspection(cwd: string): boolean {
  const version = gitOutput(cwd, ["--version"]).trim();
  // Read the effective config even when the version text proves unusable;
  // both capability inputs are gathered before any ref-object command.
  const config = gitOutput(cwd, ["config", "--null", "--list"]);
  const match = /^git version\s+(\d+)\.(\d+)\.(\d+)(?:\D|$)/.exec(version);
  if (!match) return false;

  // `--list` succeeds even when neither marker is configured, so any command
  // failure remains distinguishable from an inspected marker-free config.
  const hasPartialCloneMarker = config.split("\0").some((entry) => {
    const key = entry.slice(0, entry.indexOf("\n")).toLowerCase();
    return key === "extensions.partialclone" || /^remote\..+\.promisor$/.test(key);
  });

  const major = BigInt(match[1]!);
  const minor = BigInt(match[2]!);
  const supportsNoLazyFetch = major > 2n || (major === 2n && minor >= 45n);
  return supportsNoLazyFetch || !hasPartialCloneMarker;
}

/**
 * Returns the ref-wide maximum, or `undefined` after any Git failure.  The
 * result is all-or-nothing so a failed tree read cannot leave a misleading
 * partial maximum in use.
 */
function refMaximum(studioRoot: string, directory: RecordDirectory, pattern: RegExp): bigint | undefined {
  try {
    const discoveredRoot = gitOutput(studioRoot, ["rev-parse", "--show-toplevel"]).trim();
    const physicalRepo = realpathSync(discoveredRoot);
    const studioRelative = relative(physicalRepo, studioRoot);
    if (studioRelative === ".." || studioRelative.startsWith(`..${sep}`)) throw new Error("officina is outside its Git worktree");
    if (!supportsSafeRefInspection(physicalRepo)) return undefined;

    const gitDirectory = [...(studioRelative ? studioRelative.split(sep) : []), directory].join("/");
    const refs = gitOutput(physicalRepo, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ])
      .split(/\r?\n/)
      .filter((ref) => ref.length > 0);

    let maximum = 0n;
    for (const ref of refs) {
      const paths = gitOutput(physicalRepo, ["ls-tree", "-r", "-z", "--name-only", ref, "--", gitDirectory]).split("\0");
      const directoryPrefix = `${gitDirectory}/`;
      for (const path of paths) {
        if (!path.startsWith(directoryPrefix)) continue;
        const name = path.slice(directoryPrefix.length);
        if (name.includes("/")) continue;
        const suffix = numericSuffix(name, pattern);
        if (suffix !== undefined && suffix > maximum) maximum = suffix;
      }
    }
    return maximum;
  } catch {
    return undefined;
  }
}

export function requireRealDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`record directory must be a real directory, not a symbolic link: ${path}`);
  }
}

export function createNextRecord(
  studioRoot: string,
  directory: RecordDirectory,
  prefix: RecordPrefix,
  render: (id: string) => string | Uint8Array,
): CreatedRecord {
  const physicalStudio = realpathSync(studioRoot);
  const directoryPath = join(physicalStudio, directory);
  mkdirSync(directoryPath, { recursive: true });
  requireRealDirectory(directoryPath);
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.md$`);
  const local = localMaximum(directoryPath, pattern);
  const fromRefs = refMaximum(physicalStudio, directory, pattern);
  if (fromRefs === undefined) {
    console.error("warning: Git ref-wide allocation unavailable; using local records only");
  }

  let candidate = (local > (fromRefs ?? 0n) ? local : (fromRefs ?? 0n)) + 1n;
  for (let collisions = 0; ; collisions++) {
    if (candidate > MAX_SUFFIX) {
      throw new Error(`record id exhaustion: no suffix at or below ${MAX_SUFFIX} remains for prefix ${prefix}`);
    }
    const id = `${prefix}-${String(candidate).padStart(3, "0")}`;
    const path = join(directoryPath, `${id}.md`);
    try {
      const contents = render(id);
      requireRealDirectory(directoryPath);
      writeFileSync(path, contents, { flag: "wx" });
      return { id, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (collisions + 1 >= MAX_EEXIST_RETRIES) {
        throw new Error(`record allocation stopped after ${MAX_EEXIST_RETRIES} EEXIST collisions for prefix ${prefix}`);
      }
      candidate++;
    }
  }
}
