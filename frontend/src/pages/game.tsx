import { Maximize, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "wouter";

import { artBackground, GameArt } from "@/components/game-art";
import { allShelves, findGame, moreGames } from "@/data/home";
import { useCatalog } from "@/hooks/use-catalog";
import type { Game } from "@/lib/api";
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
 * Where the Flash player will run. Until then it shows the cover and a play
 * button. The 4:3 stage is capped so the whole panel fits the window (or the
 * screen, in full screen), letterboxed in black.
 */
function Stage({ game, ref }: { game: Game; ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="flex items-center bg-black">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[calc((100svh-17rem)*4/3)] min-w-0 overflow-hidden [:fullscreen>&]:max-w-[calc(100svh*4/3)]">
        <GameArt game={game} kind="card" className="opacity-40" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white">
          <button
            disabled
            className="grid size-20 place-items-center rounded-full bg-white/90 text-black shadow-xl disabled:cursor-not-allowed"
            aria-label="开始游戏"
          >
            <Play className="size-8 translate-x-0.5 fill-current" />
          </button>
          <p className="text-sm text-white/80">Flash 播放器即将接入</p>
        </div>
      </div>
    </div>
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
