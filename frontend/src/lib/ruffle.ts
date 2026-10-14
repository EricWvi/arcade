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
  deviceFontRenderer?: "embedded" | "canvas";
};

type RuffleHandle = { load(options: RuffleLoadOptions): Promise<void>; volume: number };

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

const handle = (player: RufflePlayer) =>
  typeof player.ruffle === "function" ? player.ruffle() : (player as unknown as RuffleHandle);

type EditContextConstructor = new () => object;

/**
 * Keeps browser extensions' keyboard shortcuts out of the game. Extensions
 * such as Global Speed (J slows video down) listen on the window before the
 * page can, but skip keys typed into editable elements. An EditContext
 * makes the player count as one without changing how it gets keys. Only
 * Chromium has EditContext, and touch screens would open their keyboard,
 * so elsewhere this does nothing.
 */
export function shieldFromShortcuts(player: RufflePlayer) {
  const EditContext = (window as { EditContext?: EditContextConstructor }).EditContext;
  if (!EditContext || !window.matchMedia("(pointer: fine)").matches) return;
  try {
    (player as RufflePlayer & { editContext: object }).editContext = new EditContext();
  } catch (err) {
    console.warn("shield player from shortcuts", err);
  }
}

export const loadMovie = (player: RufflePlayer, options: RuffleLoadOptions) => handle(player).load(options);

/** Sets the volume, 0 to 1. Ruffle ignores it until a movie is loaded. */
export function setVolume(player: RufflePlayer, volume: number) {
  handle(player).volume = volume;
}
