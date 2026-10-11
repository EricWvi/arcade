import { api } from "@/lib/api";

/*
 * Records each visit to a game page as one play. The page reports running
 * totals when the game starts, every half minute, and when it is hidden or
 * closed; the server keeps the largest, so lost or repeated reports do no
 * harm. Plays close together (a reload, say) can be merged when shown.
 */

const reportEvery = 30_000;
/** Without a key press or mouse use for this long, the player is away. */
const idleAfter = 2 * 60_000;

export type PlayTracker = {
  /** Counts an upload of changed saves, a rough measure of progress. */
  saveWritten(): void;
  /** Stops tracking after a last report. */
  stop(): void;
};

/**
 * Tracks a play of game on stage, the element holding the player. Time
 * counts as active while the page is visible and the player has used the
 * keyboard or mouse in the last two minutes.
 */
export function trackPlay(game: string, stage: HTMLElement, isMuted: () => boolean): PlayTracker {
  const id = crypto.randomUUID();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const totals = { activeMs: 0, fullscreenMs: 0, keys: 0, clicks: 0, saveWrites: 0 };
  let lastInput = Date.now();
  let lastTick = performance.now();

  const onKey = (e: KeyboardEvent) => {
    if (!e.repeat) totals.keys++;
    lastInput = Date.now();
  };
  const onPointerDown = () => {
    totals.clicks++;
    lastInput = Date.now();
  };
  const onPointerMove = () => {
    lastInput = Date.now();
  };

  const tick = window.setInterval(() => {
    const now = performance.now();
    // A throttled background timer may fire late; never count a long gap.
    const elapsed = Math.min(now - lastTick, 5000);
    lastTick = now;
    if (document.visibilityState !== "visible" || Date.now() - lastInput > idleAfter) return;
    totals.activeMs += elapsed;
    if (document.fullscreenElement) totals.fullscreenMs += elapsed;
  }, 1000);

  const report = (keepalive = false) => {
    api
      .putPlay(
        id,
        {
          game,
          activeMs: Math.round(totals.activeMs),
          fullscreenMs: Math.round(totals.fullscreenMs),
          keys: totals.keys,
          clicks: totals.clicks,
          saveWrites: totals.saveWrites,
          muted: isMuted(),
          timezone,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        },
        keepalive,
      )
      .catch((err: unknown) => console.warn("report play", err));
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") report(true);
  };
  const onPageHide = () => report(true);

  window.addEventListener("keydown", onKey, true);
  stage.addEventListener("pointerdown", onPointerDown, true);
  stage.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  const reporter = window.setInterval(report, reportEvery);
  report();

  return {
    saveWritten: () => {
      totals.saveWrites++;
    },
    stop: () => {
      window.clearInterval(tick);
      window.clearInterval(reporter);
      window.removeEventListener("keydown", onKey, true);
      stage.removeEventListener("pointerdown", onPointerDown, true);
      stage.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      report(true);
    },
  };
}
