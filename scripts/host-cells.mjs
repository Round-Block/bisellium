/**
 * Host-owned W-130 cell descriptors. Pure: the only fs use is the two read-only
 * stat calls in browserCache, and no ambient state (process.env, os.homedir) is
 * read here: the runner passes both in. Never loaded from candidate code;
 * run-builder-host.mjs reaches it by a relative specifier and nothing copies or
 * binds it into any cell.
 *
 * The descriptors are what the runner hands `sandboxArgs`; they live here so the
 * confinement can be asserted directly instead of only observed from inside a cell.
 */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The fixed cell path the host's browser cache is bound at, read-only. */
const BROWSERS_AT = "/browsers";

/** The host's playwright browser cache (realpath), or undefined. Resolved from the host's own
 *  environment, never from the request, the red log or the candidate. */
export const browserCache = (env, home) => {
  const named = env["PLAYWRIGHT_BROWSERS_PATH"];
  const dir = named && isAbsolute(named) ? named : join(home, ".cache", "ms-playwright");
  try {
    return statSync(dir).isDirectory() ? realpathSync(dir) : undefined;
  } catch {
    return undefined;
  }
};

/** The read-only bind, the one environment name and the run-start log line; empty but present when undefined. */
export const browserMounts = (resolved) =>
  resolved === undefined
    ? { roBinds: [], env: {}, log: "no playwright browser cache found; a browser red cannot reproduce" }
    : {
        roBinds: [[resolved, BROWSERS_AT]],
        env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_AT },
        log: `browser cache bound read-only at ${BROWSERS_AT} from ${resolved}`,
      };

/** The one fixed host command that builds the web bundle, and the file it must leave. */
export const WEB_BUILD = ["npm", "--workspace", "@bisellium/web", "run", "build"];
export const WEB_BUNDLE = ["apps", "web", "dist", "index.html"];

const PREP = {
  exit: (status) => `web bundle build exited ${status}`,
  spawn: () => "web bundle build could not be spawned",
  bundle: () => `the web bundle build left no ${WEB_BUNDLE.join("/")}`,
};
/** A replay-preparation failure, a message class disjoint from a refused red. */
export const prepFailure = (behaviour, kind, status) =>
  `red ${behaviour} replay preparation failed: ${PREP[kind](status)}`;

/** The builder cell: W-125's shape plus, when the cache resolved, one read-only bind and one name. */
export const builderCell = ({ clone, runtime, etc, sella, slug, session, browsers }) => {
  const mounts = browserMounts(browsers);
  return {
    binds: [
      [clone, "/workspace"],
      [join(runtime, "home"), "/home/builder"],
      [join(runtime, "tmp"), "/tmp"],
      [join(runtime, "cache"), "/cache"],
    ],
    roBinds: [
      [join(clone, ".git"), "/workspace/.git"],
      [join(runtime, "tools"), "/tools"],
      [join(runtime, "control"), "/control"], // the two named pipes only; read-only so the builder cannot replace or litter them
      ["/dev/null", "/usr/bin/git"],
      [join(runtime, "git-core-mask"), "/usr/lib/git-core"],
      ...etc,
      ...mounts.roBinds,
    ],
    chdir: "/workspace",
    env: {
      PATH: "/tools:/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/builder",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      CI: "1",
      GIT_AUTHOR_NAME: sella,
      GIT_AUTHOR_EMAIL: `${sella}@${slug}.bisellium`,
      GIT_COMMITTER_NAME: sella,
      GIT_COMMITTER_EMAIL: `${sella}@${slug}.bisellium`,
      BISELLIUM_SELLA: sella,
      BISELLIUM_STUDIO: slug,
      BISELLIUM_SESSION: session,
      npm_config_cache: "/cache/npm",
      npm_config_userconfig: "/home/builder/.npmrc",
      npm_config_globalconfig: "/home/builder/.npmrc-global",
      npm_config_registry: "https://registry.npmjs.org",
      ...mounts.env,
    },
  };
};

/** The replay cell, shared by replay preparation (the web build) and the replay itself. */
export const replayCell = ({ checkout, root, etc, nodeBin, browsers }) => {
  const mounts = browserMounts(browsers);
  return {
    binds: [
      [checkout, "/candidate"],
      [join(root, "home"), "/home/builder"],
      [join(root, "tmp"), "/tmp"],
    ],
    roBinds: [...etc, ...mounts.roBinds],
    chdir: "/candidate",
    env: {
      PATH: `${nodeBin}:/usr/local/bin:/usr/bin:/bin`,
      HOME: "/home/builder",
      TMPDIR: "/tmp",
      CI: "1",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      ...mounts.env,
    },
  };
};
