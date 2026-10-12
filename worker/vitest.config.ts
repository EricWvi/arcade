import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const worker = (bindings: Record<string, unknown>) =>
  cloudflareTest(async () => ({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: {
        GITHUB_CLIENT_ID: "client-id",
        GITHUB_CLIENT_SECRET: "client-secret",
        TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        ...bindings,
      },
    },
  }));

export default defineConfig({
  test: {
    projects: [
      // The Worker's own tests, GitHub sign-in included.
      {
        plugins: [worker({})],
        test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
      },
      // The API contract (contract/api.ts) against each implementation.
      {
        plugins: [worker({ DEV_USER: "eric" })],
        test: {
          name: "contract:worker",
          include: ["contract/worker.test.ts"],
          setupFiles: ["./test/setup.ts"],
          globalSetup: ["./contract/published.ts"],
        },
      },
      {
        test: {
          name: "contract:go",
          include: ["contract/go.test.ts"],
          environment: "node",
          globalSetup: ["./contract/go-server.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
