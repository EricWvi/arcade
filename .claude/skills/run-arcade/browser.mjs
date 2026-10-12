// Headless Chromium against the dev site, for the run-arcade skill.
// Import it from a throwaway script; see SKILL.md.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const core = join(root, ".tmp/playwright/node_modules/playwright-core/index.mjs");
if (!existsSync(core)) throw new Error("missing playwright-core: npm i --prefix .tmp/playwright playwright-core@1.59.1");
const { chromium } = await import(core);

// playwright-core's pinned revision is rarely the one downloaded, so take
// the newest Chromium in the shared cache.
function chrome() {
  const cache = join(homedir(), ".cache/ms-playwright");
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d));
  dirs.sort((a, b) => +b.split("-")[1] - +a.split("-")[1]);
  if (!dirs.length) throw new Error(`no Chromium in ${cache}: npx playwright install chromium`);
  return join(cache, dirs[0], "chrome-linux64/chrome");
}

/**
 * Opens the site at path. shot(name) writes <out>/<name>.png; errors
 * collects console errors and page exceptions.
 */
export async function open({ path = "/", width = 1440, height = 900, base = "http://localhost:5173", out = join(root, ".tmp/shots") } = {}) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome() });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + path, { waitUntil: "networkidle" });
  return {
    page,
    errors,
    shot: (name) => page.screenshot({ path: join(out, `${name}.png`) }),
    close: () => browser.close(),
  };
}

/**
 * Samples selector's bounding box top once per frame for ms, starting now:
 * an animation's real curve and duration, which screenshots cannot show.
 * Start it, trigger the animation, then await it. Rows are [ms, top|null].
 */
export const frames = (page, selector, ms) =>
  page.evaluate(
    ([selector, ms]) =>
      new Promise((done) => {
        const rows = [];
        const t0 = performance.now();
        const tick = () => {
          const t = performance.now() - t0;
          const el = document.querySelector(selector);
          rows.push([Math.round(t), el ? Math.round(el.getBoundingClientRect().top) : null]);
          t < ms ? requestAnimationFrame(tick) : done(rows);
        };
        requestAnimationFrame(tick);
      }),
    [selector, ms],
  );
