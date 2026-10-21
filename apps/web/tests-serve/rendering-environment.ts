import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { BASELINE_BOOTSTRAP_REASON, baselineSetState } from "./baseline-set.js";
import { REPO_ROOT } from "./harness.js";

export interface RenderingEnvironment {
  runnerOs: string;
  imageOs: string;
  imageVersion: string;
  node: string;
  playwright: string;
  chromium: string;
}

export function renderingEnvironment(): RenderingEnvironment {
  const playwright = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "@playwright", "test", "package.json"), "utf8")) as { version?: unknown };
  const value = {
    runnerOs: process.env["RUNNER_OS"] ?? "",
    imageOs: process.env["ImageOS"] ?? "",
    imageVersion: process.env["ImageVersion"] ?? "",
    node: process.version,
    playwright: typeof playwright.version === "string" ? playwright.version : "",
    chromium: execFileSync(chromium.executablePath(), ["--version"], { encoding: "utf8" }).trim(),
  };
  for (const [key, item] of Object.entries(value)) if (item === "") throw new Error(`rendering environment has no ${key}`);
  return value;
}

export function expectRenderingEnvironment(path: string): void {
  assert.deepEqual(renderingEnvironment(), JSON.parse(readFileSync(path, "utf8")), "rendering environment matches the reviewed baseline identity");
}

export function readRenderingEnvironmentMode(
  refresh = process.env["BISELLIUM_UPDATE_SCREENSHOTS"],
  githubActions = process.env["GITHUB_ACTIONS"],
): "compare" | "write" {
  if (refresh === undefined || refresh === "0") return "compare";
  if (refresh !== "1") throw new Error("BISELLIUM_UPDATE_SCREENSHOTS must be 0 or 1");
  if (githubActions !== "true") throw new Error("rendering environment refresh requires GitHub Actions");
  return "write";
}

function writeRenderingEnvironment(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(renderingEnvironment(), null, 2)}\n`);
}

export function syncRenderingEnvironment(
  path: string,
  refresh = process.env["BISELLIUM_UPDATE_SCREENSHOTS"],
  githubActions = process.env["GITHUB_ACTIONS"],
): void {
  if (readRenderingEnvironmentMode(refresh, githubActions) === "write") {
    writeRenderingEnvironment(path);
    return;
  }
  if (baselineSetState(dirname(path)) === "absent") {
    process.stdout.write(`${BASELINE_BOOTSTRAP_REASON}\n`);
    return;
  }
  expectRenderingEnvironment(path);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path === undefined) throw new Error("usage: rendering-environment.ts <output.json>");
  syncRenderingEnvironment(path);
}
