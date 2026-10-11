import { Maximize, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { artBackground, GameArt } from "@/components/game-art";
import { allShelves, findGame, gameSource, moreGames } from "@/data/home";
import { useCatalog } from "@/hooks/use-catalog";
import type { Game, Swf } from "@/lib/api";
import { loadMovie, type Ruffle, ruffleChromeUrl, ruffleDownloadsUrl, waitForRuffle } from "@/lib/ruffle";
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

      <div className="mx-auto grid max-w-7xl items-start gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:px-8 lg:py-10">
        <section className="overflow-hidden rounded-3xl bg-background/90 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:ring-white/10">
          <header className="flex items-center gap-4 p-4 sm:px-6">
            <span className="relative size-14 shrink-0 overflow-hidden rounded-2xl" style={{ backgroundColor: artBackground(game, true) }}>
              <GameArt game={game} kind="icon" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight">{game.title}</h1>
              <p className="truncate text-sm text-muted">{game.subtitle}</p>
            </div>
            <button
              onClick={() => stage.current?.requestFullscreen()}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-pill px-4 py-1.5 text-sm font-bold text-accent"
            >
              <Maximize className="size-4" />
              全屏
            </button>
          </header>
          <Stage ref={stage} game={game} />
        </section>

        <MoreGames games={more} />
      </div>
    </main>
  );
}

/**
 * Where the game runs, in the Ruffle extension. The stage keeps the movie's
 * aspect ratio and is capped so the whole panel fits the window (or the
 * screen, in full screen), letterboxed in black.
 */
function Stage({ ref, game }: { ref: React.Ref<HTMLDivElement>; game: Game }) {
  const ratio = game.swf?.width && game.swf.height ? game.swf.width / game.swf.height : 4 / 3;
  return (
    <div ref={ref} className="flex items-center bg-black">
      <div
        style={{ "--ratio": ratio, aspectRatio: ratio } as React.CSSProperties}
        className="relative mx-auto w-full max-w-[calc((100svh-17rem)*var(--ratio))] min-w-0 overflow-hidden [:fullscreen>&]:max-w-[calc(100svh*var(--ratio))]"
      >
        {game.swf ? <Player key={game.id} game={game} swf={game.swf} /> : <Notice title="这个游戏还不能玩" />}
      </div>
    </div>
  );
}

type PlayerState = "detecting" | "missing" | "ready" | "playing" | "failed";

/** Waits for Ruffle, then starts the movie on a click, so it may play sound. */
function Player({ game, swf }: { game: Game; swf: Swf }) {
  const { url, base } = gameSource(game.id, swf);
  const [state, setState] = useState<PlayerState>("detecting");
  const ruffle = useRef<Ruffle | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    waitForRuffle().then((found) => {
      if (!live) return;
      ruffle.current = found;
      setState(found ? "ready" : "missing");
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state !== "playing" || !ruffle.current || !host.current) return;
    const player = ruffle.current.createPlayer();
    player.className = "absolute inset-0 size-full";
    host.current.append(player);
    loadMovie(player, {
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
    }).catch((err: unknown) => {
      console.error("ruffle load", err);
      setState("failed");
    });
    return () => player.remove();
  }, [state, url, base]);

  switch (state) {
    case "detecting":
      return null;
    case "missing":
      return <InstallRuffle />;
    case "failed":
      return <Notice title="游戏加载失败" detail="刷新页面再试一次" />;
    case "ready":
      return (
        <div className="absolute inset-0 grid place-items-center">
          <button
            onClick={() => setState("playing")}
            className="grid size-20 place-items-center rounded-full bg-white/90 text-black shadow-xl transition hover:scale-105 hover:bg-white"
            aria-label="开始游戏"
          >
            <Play className="size-8 translate-x-0.5 fill-current" />
          </button>
        </div>
      );
    case "playing":
      return <div ref={host} className="absolute inset-0" />;
  }
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
