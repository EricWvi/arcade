import { Bell, BellOff, Maximize, PanelRight, RectangleHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { FileSaves } from "@/components/file-saves";
import { artBackground, GameArt } from "@/components/game-art";
import { allShelves, findGame, gameSource, moreGames } from "@/data/home";
import { useCatalog } from "@/hooks/use-catalog";
import type { Game, Saves, Swf } from "@/lib/api";
import {
  loadMovie,
  type Ruffle,
  ruffleChromeUrl,
  ruffleDownloadsUrl,
  type RufflePlayer,
  setVolume,
  shieldFromShortcuts,
  waitForRuffle,
} from "@/lib/ruffle";
import { type PlayTracker, trackPlay } from "@/lib/plays";
import { restoreSaves, sharedObjectPrefix, syncSaves } from "@/lib/saves";
import { NotFound } from "@/pages/not-found";

export function GamePage({ id }: { id: string }) {
  const catalog = useCatalog();
  if (catalog.isPending) return <main className="flex-1" />;
  const shelves = allShelves(catalog.data);
  const game = findGame(shelves, id);
  if (!game) return <NotFound message={catalog.error ? catalog.error.message : "游戏不存在"} />;
  return <Playfield game={game} more={moreGames(shelves, game)} />;
}

/**
 * The game in a floating panel over its full-screen background, with other
 * games beside it. Background art carries no shadows; they are added here.
 */
function Playfield({ game, more }: { game: Game; more: Game[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useStoredFlag("arcade:muted");
  // Theater mode gives the game the full width on large screens, with the
  // other panels moved below it.
  const [theater, setTheater] = useStoredFlag("arcade:theater");
  const ratio = stageRatio(game);

  useEffect(() => {
    document.title = `${game.title} - Arcade`;
    window.scrollTo(0, 0);
    return () => {
      document.title = "Arcade";
    };
  }, [game]);

  return (
    <main className="relative isolate flex-1">
      <div className="fixed inset-0 -z-10" style={{ backgroundColor: artBackground(game, true) }}>
        <GameArt game={game} kind="background" />
        {/* Darkens the edges so the panels stand out from any background. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgb(0_0_0/0.35))] dark:bg-black/30 dark:bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.2)_35%,rgb(0_0_0/0.6))]" />
      </div>

      <div
        style={{ "--ratio": ratio } as React.CSSProperties}
        className={`mx-auto grid max-w-7xl items-start gap-6 px-4 py-6 sm:px-6 lg:px-8 ${
          // As wide as the stage can be at this height, plus the side padding.
          theater ? "lg:max-w-[calc((100svh-12rem)*var(--ratio)+4rem)] lg:py-4" : "lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-10"
        }`}
      >
        <section className="overflow-hidden rounded-3xl bg-background/90 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/10">
          <header className="flex items-center gap-4 p-4 sm:px-6">
            <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl" style={{ backgroundColor: artBackground(game, true) }}>
              <GameArt game={game} kind="icon" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight">{game.title}</h1>
              <p className="truncate text-sm text-muted">{game.subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {game.swf && <SoundBell muted={muted} onToggle={() => setMuted(!muted)} />}
              {/* Below lg the panels already stack, so there is nothing to widen. */}
              <button
                onClick={() => setTheater(!theater)}
                aria-pressed={theater}
                className="hidden shrink-0 items-center gap-1.5 rounded-full bg-pill px-4 py-1.5 text-sm font-bold text-accent lg:flex"
              >
                {theater ? <PanelRight className="size-4" /> : <RectangleHorizontal className="size-4" />}
                {theater ? "窄屏" : "宽屏"}
              </button>
              <button
                onClick={() => stage.current?.requestFullscreen()}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-pill px-4 py-1.5 text-sm font-bold text-accent"
              >
                <Maximize className="size-4" />
                全屏
              </button>
            </div>
          </header>
          <Stage ref={stage} game={game} muted={muted} theater={theater} />
        </section>

        <div className={`space-y-6 ${theater ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0" : ""}`}>
          <MoreGames games={more} />
          {game.help && <Help text={game.help} />}
        </div>
      </div>
    </main>
  );
}

/** The movie's aspect ratio, or 4:3 until it is known. */
const stageRatio = (game: Game) => (game.swf?.width && game.swf.height ? game.swf.width / game.swf.height : 4 / 3);

/**
 * Where the game runs, in the Ruffle extension. The stage keeps the movie's
 * aspect ratio and is capped so the whole panel fits the window (or the
 * screen, in full screen), letterboxed in black.
 */
function Stage({ ref, game, muted, theater }: { ref: React.Ref<HTMLDivElement>; game: Game; muted: boolean; theater: boolean }) {
  const ratio = stageRatio(game);
  return (
    <div ref={ref} className="flex items-center bg-black">
      <div
        style={{ "--ratio": ratio, aspectRatio: ratio } as React.CSSProperties}
        className={`relative mx-auto w-full max-w-[calc((100svh-17rem)*var(--ratio))] min-w-0 overflow-hidden [:fullscreen>&]:max-w-[calc(100svh*var(--ratio))] ${
          // Theater mode trims the page's vertical padding, leaving more height.
          theater ? "lg:max-w-[calc((100svh-12rem)*var(--ratio))]" : ""
        }`}
      >
        {game.swf ? <Player key={game.id} game={game} swf={game.swf} muted={muted} /> : <Notice title="这个游戏还不能玩" />}
      </div>
    </div>
  );
}

type PlayerState = "detecting" | "missing" | "playing" | "failed";

/**
 * Restores the user's saves, then starts the movie as soon as Ruffle is
 * found, and keeps the saves synced and the play recorded while it runs.
 * Browsers hold back sound until the first click or key press, which
 * Ruffle then resumes.
 */
function Player({ game, swf, muted }: { game: Game; swf: Swf; muted: boolean }) {
  const { url, base } = gameSource(game.id, swf);
  const [state, setState] = useState<PlayerState>("detecting");
  const [error, setError] = useState("");
  const ruffle = useRef<Ruffle | null>(null);
  const synced = useRef<Saves>({});
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<RufflePlayer | null>(null);
  const loaded = useRef(false);
  const mutedNow = useRef(muted);
  mutedNow.current = muted;
  const prefix = sharedObjectPrefix(url);
  const fileSaves = game.saves === "file";
  const tracker = useRef<PlayTracker | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const found = await waitForRuffle();
      if (!found) {
        if (live) setState("missing");
        return;
      }
      try {
        // File saves are loaded by the player from the save dialog instead.
        if (!fileSaves) synced.current = await restoreSaves(game.id, prefix);
      } catch (err) {
        console.error("restore saves", err);
        if (live) {
          setError("存档读取失败");
          setState("failed");
        }
        return;
      }
      ruffle.current = found;
      if (live) setState("playing");
    })();
    return () => {
      live = false;
    };
  }, [game.id, prefix, fileSaves]);

  useEffect(() => {
    if (state !== "playing" || !ruffle.current || !host.current) return;
    const el = ruffle.current.createPlayer();
    el.className = "absolute inset-0 size-full";
    host.current.append(el);
    shieldFromShortcuts(el);
    player.current = el;
    loadMovie(el, {
      url,
      base,
      autoplay: "on",
      backgroundColor: "#000000",
      letterbox: "on",
      unmuteOverlay: "hidden",
      splashScreen: false,
      warnOnUnsupportedContent: false,
      allowScriptAccess: false,
      contextMenu: "rightClickOnly",
      openUrlMode: "confirm",
      // Text in system fonts such as SimSun; Ruffle's own font has no Chinese.
      deviceFontRenderer: "canvas",
    })
      .then(() => {
        loaded.current = true;
        setVolume(el, mutedNow.current ? 0 : 1);
      })
      .catch((err: unknown) => {
        console.error("ruffle load", err);
        setError("游戏加载失败");
        setState("failed");
      });
    const play = trackPlay(game.id, host.current, () => mutedNow.current);
    tracker.current = play;
    const stopSync = fileSaves ? () => {} : syncSaves(game.id, prefix, synced.current, play.saveWritten);
    return () => {
      // Ruffle may flush saves as it is torn down, so sync after removing it.
      el.remove();
      player.current = null;
      loaded.current = false;
      stopSync();
      play.stop();
      tracker.current = null;
    };
  }, [state, url, base, game.id, prefix, fileSaves]);

  useEffect(() => {
    if (player.current && loaded.current) setVolume(player.current, muted ? 0 : 1);
  }, [muted]);

  switch (state) {
    case "detecting":
      return null;
    case "missing":
      return <InstallRuffle />;
    case "failed":
      return <Notice title={error} detail="刷新页面再试一次" />;
    case "playing":
      return (
        <>
          <div ref={host} className="absolute inset-0" />
          {fileSaves && (
            <FileSaves game={game} onSaved={() => tracker.current?.saveWritten()} onClose={() => player.current?.focus()} />
          )}
        </>
      );
  }
}

/** A yes/no setting remembered in this browser under key. */
function useStoredFlag(key: string) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      // Not remembered, which only matters on the next visit.
    }
  };
  return [on, set] as const;
}

/**
 * Turns game sound on and off, as a pill beside the full screen button.
 * Like YouTube's subscribe bell, turning sound on rings the bell inside a
 * ripple and muting pops it; each click replays the animation.
 */
function SoundBell({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  const [clicks, setClicks] = useState(0);
  const Icon = muted ? BellOff : Bell;
  return (
    <button
      onClick={() => {
        setClicks((n) => n + 1);
        onToggle();
      }}
      aria-pressed={muted}
      className={`flex shrink-0 items-center gap-1.5 rounded-full bg-pill px-4 py-1.5 text-sm font-bold ${muted ? "text-muted" : "text-accent"}`}
    >
      <span className="relative grid size-4 place-items-center">
        {clicks > 0 && !muted && (
          <span
            key={`ripple-${clicks}`}
            className="absolute -inset-1.5 rounded-full bg-accent motion-safe:animate-bell-ripple motion-reduce:hidden"
          />
        )}
        <Icon
          key={clicks}
          className={`relative size-4 origin-top ${clicks === 0 ? "" : muted ? "motion-safe:animate-bell-pop" : "motion-safe:animate-bell-ring"}`}
        />
      </span>
      {muted ? "静音" : "声音"}
    </button>
  );
}

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center text-white">
      <p className="font-semibold">{title}</p>
      {detail && <p className="text-sm text-white/70">{detail}</p>}
    </div>
  );
}

/** Shown when the Ruffle extension is missing, with the usual store badge. */
function InstallRuffle() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center text-white">
      <div className="space-y-1.5">
        <p className="text-lg font-bold">需要安装 Ruffle 扩展</p>
        <p className="max-w-sm text-sm text-white/70">Ruffle 是开源的 Flash 模拟器。安装扩展后刷新页面即可开始游戏。</p>
      </div>
      <a
        href={ruffleChromeUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-xl bg-white py-2 pr-5 pl-3 text-left text-black shadow-lg ring-1 ring-black/10 transition hover:bg-white/90"
      >
        <ChromeLogo className="size-9" />
        <span className="leading-tight">
          <span className="block text-[0.6875rem] text-black/60">可从以下位置获取</span>
          <span className="block font-semibold">Chrome 应用商店</span>
        </span>
      </a>
      <div className="flex items-center gap-4 text-sm">
        <button onClick={() => window.location.reload()} className="font-semibold text-white hover:underline">
          已安装？刷新页面
        </button>
        <a href={ruffleDownloadsUrl} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white hover:underline">
          其他浏览器
        </a>
      </div>
    </div>
  );
}

function ChromeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path d="M24 24 4.95 13A22 22 0 0 1 43.05 13Z" fill="#ea4335" />
      <path d="M24 24 43.05 13A22 22 0 0 1 24 46Z" fill="#fbbc04" />
      <path d="M24 24 24 46A22 22 0 0 1 4.95 13Z" fill="#34a853" />
      <circle cx="24" cy="24" r="10" fill="#fff" />
      <circle cx="24" cy="24" r="8" fill="#1a73e8" />
    </svg>
  );
}

function Help({ text }: { text: string }) {
  return (
    <section className="rounded-3xl bg-background/90 px-6 py-6 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/10">
      <h2 className="text-lg font-bold tracking-tight">玩法说明</h2>
      <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-muted">{text}</p>
    </section>
  );
}

function MoreGames({ games }: { games: Game[] }) {
  if (games.length === 0) return null;
  return (
    <aside className="rounded-3xl bg-background/90 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/10">
      <h2 className="px-2 pb-2 text-lg font-bold tracking-tight">更多游戏</h2>
      <ul>
        {games.map((g) => (
          <li key={g.id}>
            <Link href={`/games/${g.id}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-surface">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-xl" style={{ backgroundColor: artBackground(g, true) }}>
                <GameArt game={g} kind="icon" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{g.title}</span>
                <span className="block truncate text-sm text-muted">{g.subtitle}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
