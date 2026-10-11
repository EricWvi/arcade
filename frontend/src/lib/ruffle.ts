/*
 * The Ruffle browser extension, which players install to run Flash. It
 * injects window.RufflePlayer into every page; the site never ships Ruffle.
 */

export const ruffleChromeUrl = "https://chromewebstore.google.com/detail/donbcfbmhbcapadipfkeojnmajbakjdc";
export const ruffleDownloadsUrl = "https://ruffle.rs/#downloads";

/** Options passed to Ruffle's load(); see Ruffle's BaseLoadOptions. */
export type RuffleLoadOptions = {
  url: string;
  base?: string;
  autoplay?: "on" | "off" | "auto";
  backgroundColor?: string;
  letterbox?: "on" | "off" | "fullscreen";
  unmuteOverlay?: "visible" | "hidden";
  splashScreen?: boolean;
  warnOnUnsupportedContent?: boolean;
  allowScriptAccess?: boolean;
  contextMenu?: "on" | "rightClickOnly" | "off";
  openUrlMode?: "allow" | "confirm" | "deny";
};

type RuffleHandle = { load(options: RuffleLoadOptions): Promise<void> };

/** A <ruffle-player>. Newer Ruffle moves load() behind ruffle(). */
export type RufflePlayer = HTMLElement & Partial<RuffleHandle> & { ruffle?: () => RuffleHandle };

export type Ruffle = { createPlayer(): RufflePlayer };

declare global {
  interface Window {
    RufflePlayer?: { newest?: () => Ruffle | null };
  }
}

/**
 * Resolves to Ruffle once the extension has set it up, or null if it does
 * not within the timeout. The extension injects it as the page loads, so
 * this is near-instant when it is installed.
 */
export function waitForRuffle(timeout = 2000): Promise<Ruffle | null> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const ruffle = window.RufflePlayer?.newest?.() ?? null;
      if (ruffle || Date.now() - started >= timeout) resolve(ruffle);
      else setTimeout(check, 100);
    };
    check();
  });
}

export function loadMovie(player: RufflePlayer, options: RuffleLoadOptions) {
  const handle = typeof player.ruffle === "function" ? player.ruffle() : (player as RuffleHandle);
  return handle.load(options);
}
