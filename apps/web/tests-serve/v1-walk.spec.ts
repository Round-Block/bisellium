/**
 * apps/web/tests-serve/v1-walk.spec.ts — W-576: End state v1's nine-step walk as one served spec, one case per step,
 * titled `W-576 S<n>: <step>`. Each case's sub-steps are its row's owners in `WALK` (packages/core/src/v1-walk.ts), one
 * `test.step("<owner>: <what>", …)` each, in order. A case is marked as an expected failure (`test.fail` inside its body,
 * so the body runs every time) exactly while `isPending` says so: a pending case that fails reports `expected` and keeps
 * `web-e2e` green, one that passes reports `unexpected` and turns it red, as does a green case that fails. A pending
 * sub-step asserts through `pend` (a 2 s assertion timeout); the owner's edit switches it to `expect(`, replaces a
 * placeholder selector with the one it ships and removes its id from `WALK`'s row. `BISELLIUM_WALK_UNMARK=1` (evidence
 * tooling, read here only, set by no gate) lifts every mark, so each pending case shows its declared first failing
 * assertion. Every studio is a fresh temp copy of examples/sample-studio (S9's a fresh `init`-ed repo on `main`), served
 * by the W-067 harness, unchanged. See studio/briefs/W-576.md.
 */
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { WALK, isPending, type Step } from "../../../packages/core/src/v1-walk.js";
import { recordOnly } from "../../../scripts/ci-scope.mjs";
import { REPO_ROOT, seedToken, startServed, type ServedInstance } from "./harness.js";

/** The pending timeout: a pending sub-step fails in seconds, not at the case's 30 s timeout. Pending sub-steps only. */
const pend = expect.configure({ timeout: 2_000 });
const UNMARK = process.env["BISELLIUM_WALK_UNMARK"] === "1";
/** The mark: pending while `isPending`, unless the marks are lifted. */
const marked = (step: Step): boolean => !UNMARK && isPending(step);
const mark = (step: Step): string =>
  step === "S8" ? "pending: S2..S7" : `pending: ${(WALK.find((r) => r.step === step)?.pending ?? []).join(", ")}`;
const MAIN_TS = join(REPO_ROOT, "packages", "cli", "src", "main.ts");

interface Walk {
  page: Page;
  served: ServedInstance;
  /** page errors and 4xx/5xx or failed requests from the served origin */
  bad: string[];
}

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

/** Serves a studio, seeds the token and opens the console, watching for page errors and bad traffic from the start. */
async function open(page: Page, tag: string, options: Parameters<typeof startServed>[1] = {}): Promise<Walk> {
  served = await startServed(`v1-walk-${tag}`, options);
  const base = served.baseURL;
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`page error: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(base) || new URL(r.url()).pathname === "/api/live") return;
    bad.push(`failed ${r.url()}`);
  });
  await seedToken(page, served);
  await page.goto(base);
  return { page, served, bad };
}

async function s2({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/home`);
  await test.step("W-503: Home shows Needs you, Stuck, Health and Work in progress", async () => {
    await pend(page.getByRole("heading", { name: "Work in progress" }), "W-503: Home's Work in progress heading").toBeVisible();
    await pend(page.getByRole("heading", { name: "Needs you" }), "W-503: Home's Needs you heading").toBeVisible();
  });
  await test.step("W-555: queue truth: one lane-occupancy function, next skips, check flags", async () => {
    await pend(page.getByRole("region", { name: "Lanes" }), "W-555: Home's Lanes region (placeholder)").toBeVisible();
  });
}

async function s3({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/board/W-007`);
  await expect(page.getByText("W-007").first(), "the backlog opus's Board drawer opens").toBeVisible();
  await test.step("W-074: decline from the Board drawer", async () => {
    await pend(page.getByRole("button", { name: "Decline" }), "W-074: the Board drawer's Decline button").toBeVisible();
  });
  await test.step("W-301: the write lands on the bare origin's master", async () => {
    pend("origin" in s, "W-301: the served instance carries a bare origin (startServed's landing option)").toBe(true);
  });
}

async function s4({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/inbox`);
  await test.step("W-666: an answer carries the Patron's signed receipt", async () => {
    const res = await page.request.post(`${s.baseURL}/api/answer`, {
      headers: { "X-Bisellium-Token": s.token },
      data: { petitio: "A-1", reply: "approve: v1 walk", receipt: "unsigned" },
    });
    expect(res.status(), "W-666: the answer route refuses a receipt that is not an object").toBe(400);
  });
  await test.step("W-668: the next boot reads each answer once", async () => {
    await pend(page.getByRole("listitem", { name: /read once/ }), "W-668: the Inbox lists an answered wait as read once").toBeVisible();
  });
  await test.step("W-667: one Inbox of every wait", async () => {
    await pend(page.getByRole("list", { name: "Every wait" }), "W-667: the Inbox lists every wait (placeholder)").toBeVisible();
  });
  await test.step("W-157: record a ruling with a reason", async () => {
    await pend(page.getByRole("button", { name: "Record a ruling" }), "W-157: the Inbox records a ruling (placeholder)").toBeVisible();
  });
  await test.step("W-546: the Patron owns the guard fence", async () => {
    pend(readFileSync(join(REPO_ROOT, ".github", "CODEOWNERS"), "utf8"), "W-546: CODEOWNERS lists the guard path").toContain("packages/cli/src/guard.ts");
  });
}

async function s5({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/board/W-001`);
  await expect(page.getByText("W-001").first(), "the done opus's Board drawer opens").toBeVisible();
  await test.step("W-673: the certificate tree leaves the handoff out, through one list", async () => {
    expect(recordOnly(["docs/SESSION-HANDOFF.md"]), "W-673: recordOnly takes the handoff").toBe(true);
  });
  await test.step("W-697: passed review goes to PR without the full suite", async () => {
    await pend(page.getByText(/red-gate reruns/), "W-697: the drawer shows red-gate reruns (placeholder)").toBeVisible();
  });
  await test.step("W-372: an agent waits on its own run", async () => {
    await pend(page.getByText(/Patron steps/), "W-372: the drawer shows Patron steps (placeholder)").toBeVisible();
  });
  await test.step("W-557: merge, cleanup and done as one chain", async () => {
    await pend(page.getByText(/runner chains/), "W-557: the drawer shows runner chains (placeholder)").toBeVisible();
  });
  await test.step("W-308: the drawer shows the four values and flags a breach", async () => {
    await pend(page.getByText(/cycle minutes/), "W-308: the drawer shows cycle minutes").toBeVisible();
  });
}

async function s6({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/board/W-002`);
  await expect(page.getByText("W-002").first(), "the building opus's Board drawer opens").toBeVisible();
  mkdirSync(join(s.studioDir, "timeline"), { recursive: true });
  appendFileSync(join(s.studioDir, "timeline", "builder.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), sella: "builder", opus: "W-002", text: "v1-walk-s6" })}\n`);
  await test.step("W-308: the opus timeline in the Board drawer", async () => {
    await pend(page.getByRole("list", { name: "Timeline" }).getByText("v1-walk-s6"), "W-308: the drawer's timeline lists the appended event").toBeVisible();
  });
}

async function s7({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/home`);
  await test.step("W-503: Home is served", async () => {
    await pend(page.getByRole("heading", { name: "Home", level: 1 }), "W-503: Home's route mounts").toBeVisible();
  });
  await test.step("W-504: the Completion row on Home", async () => {
    await pend(page.getByRole("heading", { name: "Completion" }), "W-504: Home's Completion row (placeholder)").toBeVisible();
  });
}

/** S9's studio: the harness's copy replaced by `bisellium init` in a fresh `main` repo, with one opus filed. */
function initStudio(studioDir: string): void {
  const root = dirname(studioDir);
  rmSync(studioDir, { recursive: true, force: true });
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const cli = (args: string[]): string => execFileSync(process.execPath, ["--import", "tsx", MAIN_TS, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  cli(["init", studioDir]);
  cli(["new", "--kind", "feature", "--collegium", "production", "--title", "v1 walk adopter", studioDir]);
}

async function s9({ page, served: s }: Walk): Promise<void> {
  await page.goto(`${s.baseURL}/#/board`);
  await expect(page.getByText("W-001").first(), "the Board lists the filed opus").toBeVisible();
  await test.step("W-284: the init-ed studio can run an opus", async () => {
    pend(["briefs", "receipts", "timeline"].filter((d) => !existsSync(join(s.studioDir, d))), "W-284: the init-ed studio holds briefs/, receipts/ and timeline/").toEqual([]);
  });
  await test.step("W-051: branch and merge respect the default branch", async () => {
    pend(false, "W-051: its default-branch sub-step, named by W-051's spec (placeholder)").toBe(true);
  });
}

test("W-576 S1: open the console and land on its first screen", async ({ page }) => {
  test.fail(marked("S1"), mark("S1"));
  const w = await open(page, "s1");
  await expect(page.locator(".sidebar__link--active"), "the console lands on one screen").toHaveCount(1);
  expect(w.bad, "no page error and no 4xx/5xx from the served origin").toEqual([]);
});

test("W-576 S2: see the work", async ({ page }) => {
  test.fail(marked("S2"), mark("S2"));
  await s2(await open(page, "s2"));
});

test("W-576 S3: decline or hold from the console, landed on master", async ({ page }) => {
  test.fail(marked("S3"), mark("S3"));
  await s3(await open(page, "s3"));
});

test("W-576 S4: answer every wait in one signed Inbox", async ({ page }) => {
  test.fail(marked("S4"), mark("S4"));
  await s4(await open(page, "s4"));
});

test("W-576 S5: approved work runs to done by itself, fast", async ({ page }) => {
  test.fail(marked("S5"), mark("S5"));
  await s5(await open(page, "s5"));
});

test("W-576 S6: watch a build without a reload", async ({ page }) => {
  test.fail(marked("S6"), mark("S6"));
  await s6(await open(page, "s6"));
});

test("W-576 S7: see it finished on Home", async ({ page }) => {
  test.fail(marked("S7"), mark("S7"));
  await s7(await open(page, "s7"));
});

test("W-576 S8: S2..S7 in one served session, every write on master", async ({ page }) => {
  test.fail(marked("S8"), mark("S8"));
  const w = await open(page, "s8");
  for (const step of [s2, s3, s4, s5, s6, s7]) await step(w);
  const landings = await page.request.get(`${w.served.baseURL}/api/landings`, { headers: { "X-Bisellium-Token": w.served.token } });
  expect(await landings.json(), "every console write of the walk has landed").toEqual([]);
});

test("W-576 S9: adopter: init, file one opus, serve it", async ({ page }) => {
  test.fail(marked("S9"), mark("S9"));
  await s9(await open(page, "s9", { subdir: "studio", prepareStudio: initStudio }));
});
