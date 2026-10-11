import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// In development the Go server runs on :36753 and owns /api, /auth and the game images.
const backend = process.env.ARCADE_BACKEND ?? "http://localhost:36753";

// emptyOutDir wipes dist/.gitkeep, which go:embed needs in a fresh clone.
const keepDist: Plugin = {
  name: "keep-dist",
  apply: "build",
  closeBundle() {
    writeFileSync(fileURLToPath(new URL("./dist/.gitkeep", import.meta.url)), "");
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), keepDist],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/api": backend,
      "/auth": backend,
      // Only game images and files; /games/<key> itself is an app page.
      "^/games/[^/]+/(imgs|sources)/": backend,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
