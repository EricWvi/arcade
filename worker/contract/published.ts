// Global setup for the Worker side: publishes the fixture the way a real
// deploy does, with `arcade catalog build`, and hands the R2 objects to the
// tests to upload.

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { fixture, repoRoot } from "./paths";

export default async function setup(project: TestProject) {
  const out = await mkdtemp(join(tmpdir(), "arcade-contract-"));
  try {
    execFileSync(
      "go",
      ["run", "./cmd/arcade", "catalog", "build", "-games", join(fixture, "games"), "-catalog", join(fixture, "games.yaml"), "-out", out],
      { cwd: repoRoot, stdio: "inherit" },
    );
    const objects: Record<string, string> = {
      "catalog.json": (await readFile(join(out, "catalog.json"))).toString("base64"),
    };
    for (const file of (await readFile(join(out, "files.txt"), "utf8")).split("\n").filter(Boolean)) {
      objects[file] = (await readFile(join(fixture, "games", file))).toString("base64");
    }
    project.provide("published", objects);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
