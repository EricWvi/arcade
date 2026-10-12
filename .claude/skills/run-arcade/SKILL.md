---
name: run-arcade
description: Launch the arcade site locally and drive it in headless Chromium. Use to run the app, screenshot a page, or check a UI change or animation in the real browser.
---

# Run arcade

The site is two processes: the Go server on :36753 (API, sign-in, game files) and Vite on :5173, which serves the frontend and proxies the rest to Go. Drive it at :5173.

## 1. Servers

Eric often has one or both running already; check before starting either:

```bash
ss -ltnp | grep -E ':(36753|5173)\b'
```

Start whichever is missing, in the background, and poll until it answers:

```bash
go run ./cmd/arcade -config .data/config.yaml > .tmp/server.log 2>&1 &
npm --prefix frontend run dev > .tmp/vite.log 2>&1 &
timeout 60 bash -c 'until curl -sf localhost:5173/api/version >/dev/null; do sleep 1; done'
```

`.data/config.yaml` sets `dev_user: eric`, so every request is signed in; no login step. The server reads `.data/games.yaml` only at startup: after editing it, restart the Go server (stop it with `lsof -ti:36753 -sTCP:LISTEN | xargs -r kill`). Leave running whatever you found running, and tell Eric about anything you started.

Ready when `/api/catalog` through :5173 returns the shelves.

## 2. Browser

[browser.mjs](browser.mjs) wraps `playwright-core` with the cached Chromium. Install the package once (gitignored):

```bash
[ -d .tmp/playwright/node_modules/playwright-core ] || npm i --prefix .tmp/playwright playwright-core@1.59.1
```

Write a throwaway script in the scratchpad that imports it by absolute path, then run it with `node`:

```js
import { open, frames } from "/home/eric/projects/arcade/.claude/skills/run-arcade/browser.mjs";

const { page, shot, errors, close } = await open({ width: 1440, height: 900 });
await shot("home");
await page.getByRole("button", { name: /Hot Air：查看介绍/ }).click();
await page.waitForTimeout(600);
await shot("open");
console.log(errors);
await close();
```

Screenshots land in `.tmp/shots/<name>.png`. Read each one and look at it; a change is checked when the screenshot shows it. Cover a phone width too (`width: 390, height: 844`).

For an animation, screenshots mid-flight are guesses. Start `frames(page, selector, ms)` before the trigger and await it afterwards: it logs the element's top per frame, so the curve and duration are numbers.

```js
const run = frames(page, "dialog > div", 600);
await page.keyboard.press("Escape");
console.log(await run);
```

Done when the screenshots or frame logs show the behaviour asked about and `errors` is empty.
