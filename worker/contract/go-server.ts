// Global setup for the Go side: builds cmd/arcade and serves the fixture
// with the dev user, on a free local port.

import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { fixture, repoRoot } from "./paths";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), "arcade-contract-"));
  const bin = join(dir, "arcade");
  execFileSync("go", ["build", "-o", bin, "./cmd/arcade"], { cwd: repoRoot, stdio: "inherit" });
  const port = await freePort();
  await copyFile(join(fixture, "games.yaml"), join(dir, "games.yaml"));
  await writeFile(
    join(dir, "config.yaml"),
    `listen: "127.0.0.1:${port}"\ngames_dir: ${JSON.stringify(join(fixture, "games"))}\ndev_user: eric\n`,
  );
  const server = spawn(bin, ["-config", join(dir, "config.yaml")], { stdio: ["ignore", "inherit", "inherit"] });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`go server exited with ${server.exitCode}`);
    try {
      if ((await fetch(`${origin}/api/version`)).ok) break;
    } catch {
      if (i > 100) throw new Error("go server did not start");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  project.provide("goServer", origin);
  return async () => {
    server.kill();
    await rm(dir, { recursive: true, force: true });
  };
}
