import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  BASELINE_BOOTSTRAP_REASON,
  type BaselineSource,
  baselineSetState,
  readBaselineSource,
  readBaselineWriteSource,
} from "./baseline-set.js";
import { REPO_ROOT } from "./harness.js";

export interface RenderingEnvironment {
  runnerOs: string;
  imageOs: string;
  imageVersion: string;
  node: string;
  playwright: string;
  chromium: string;
}

export interface RenderingEnvironmentRecord extends RenderingEnvironment {
  baselineSource: BaselineSource;
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

export function readRenderingEnvironmentRecord(value: unknown): RenderingEnvironmentRecord {
  if (typeof value !== "object" || value === null) throw new Error("rendering environment record is missing");
  const record = value as Record<string, unknown>;
  const environmentKeys = ["runnerOs", "imageOs", "imageVersion", "node", "playwright", "chromium"] as const;
  for (const key of environmentKeys)
    if (typeof record[key] !== "string" || record[key] === "") throw new Error(`rendering environment has no ${key}`);
  if (Object.keys(record).sort().join(",") !== [...environmentKeys, "baselineSource"].sort().join(","))
    throw new Error("rendering environment record has unexpected fields or no baseline provenance");
  return {
    runnerOs: record["runnerOs"] as string,
    imageOs: record["imageOs"] as string,
    imageVersion: record["imageVersion"] as string,
    node: record["node"] as string,
    playwright: record["playwright"] as string,
    chromium: record["chromium"] as string,
    baselineSource: readBaselineSource(record["baselineSource"]),
  };
}

export function expectRenderingEnvironment(path: string): void {
  const { baselineSource: _baselineSource, ...reviewedEnvironment } = readRenderingEnvironmentRecord(
    JSON.parse(readFileSync(path, "utf8")),
  );
  assert.deepEqual(renderingEnvironment(), reviewedEnvironment, "rendering environment matches the reviewed baseline identity");
}

export function readRenderingEnvironmentMode(
  refresh = process.env["BISELLIUM_UPDATE_SCREENSHOTS"],
  githubActions = process.env["GITHUB_ACTIONS"],
  eventName = process.env["GITHUB_EVENT_NAME"],
  ref = process.env["GITHUB_REF"],
  sha = process.env["GITHUB_SHA"],
): "compare" | "write" {
  return readBaselineWriteSource(refresh, githubActions, eventName, ref, sha) === undefined ? "compare" : "write";
}

function writeRenderingEnvironment(path: string, baselineSource: BaselineSource): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...renderingEnvironment(), baselineSource }, null, 2)}\n`);
}

export function syncRenderingEnvironment(
  path: string,
  refresh = process.env["BISELLIUM_UPDATE_SCREENSHOTS"],
  githubActions = process.env["GITHUB_ACTIONS"],
): void {
  const baselineSource = readBaselineWriteSource(refresh, githubActions);
  if (baselineSource !== undefined) {
    writeRenderingEnvironment(path, baselineSource);
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
