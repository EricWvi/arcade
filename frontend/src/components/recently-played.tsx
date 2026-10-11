import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

// The placeholder is inlined so it paints with the first render.
import defaultPosterBlur from "@/assets/default-poster.blur.webp?inline";
import defaultPoster from "@/assets/default-poster.webp";
import { BlurImage } from "@/components/blur-image";
import { artBackground, GameArt } from "@/components/game-art";
import type { RecentGame } from "@/lib/api";
import { playTime, timeAgo } from "@/lib/format";

/** The slideshow starts this long after the page opens, then moves on at slideEvery. */
const firstSlideAfter = 5000;
const slideEvery = 6000;

/**
 * The hero banner. Its background starts as the site poster; five seconds
 * in, it begins cycling through the recent games' posters and back to the
 * site poster. Hovering or focusing a game shows its poster and details and
 * pauses the cycle. Before anything has been played it is just the poster
 * and a welcome.
 */
export function RecentlyPlayed({ games = [], loading }: { games?: RecentGame[]; loading: boolean }) {
  const [active, setActive] = useState<RecentGame | null>(null);
  // 0 is the site poster, n is games[n - 1].
  const [slide, setSlide] = useState(0);
  const started = useRef(false);
  const featured = slide > 0 ? games[slide - 1] : undefined;
  const poster = active ?? featured;
  // Games shown so far. Their posters stay mounted so switching back and
  // forth fades instead of reloading; posters never shown are never fetched.
  const [seen, setSeen] = useState<string[]>([]);
  const markSeen = (id: string) => setSeen((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const show = (g: RecentGame) => {
    setActive(g);
    markSeen(g.id);
  };

  useEffect(() => {
    if (featured) markSeen(featured.id);
  }, [featured]);

  useEffect(() => {
    if (active || games.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(
      () => {
        started.current = true;
        setSlide((n) => (n + 1) % (games.length + 1));
      },
      started.current ? slideEvery : firstSlideAfter,
    );
    return () => window.clearTimeout(timer);
  }, [active, games.length, slide]);
  // While loading, assume a returning player so the headline rarely changes.
  const fresh = !loading && games.length === 0;

  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl bg-[#3a2a6b]"
      onMouseLeave={() => setActive(null)}
    >
      {/*
        Posters keep their subject on the right, so narrow screens crop from
        the left. Game posters cross-fade over the site poster, which stays
        underneath; a newly mounted one fades in from transparent too.
      */}
      <BlurImage
        src={defaultPoster}
        placeholder={defaultPosterBlur}
        alt=""
        className="absolute inset-0 -z-20"
        imgClassName="object-[75%_center]"
      />
      {games
        .filter((g) => seen.includes(g.id))
        .map((g) => (
          <GameArt
            key={g.id}
            game={g}
            kind="poster"
            className={`-z-20 transition-opacity duration-700 starting:opacity-0 ${poster?.id === g.id ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      {/*
        Keeps the white headline and tile names readable over any poster.
        Light pages get a lighter scrim so the poster stays bright; text
        shadows make up the difference.
      */}
      <div className="absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-black/15 to-transparent dark:from-black/35" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-black/40 to-transparent dark:h-2/3 dark:from-black/60" />
      <div className="flex min-h-[360px] flex-col justify-between gap-10 p-6 sm:min-h-[480px] sm:p-10">
        <div className="text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.45)]">
          <p className="text-sm font-semibold text-white/80">{fresh ? "Arcade" : "最近游玩"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">
            {active ? active.title : fresh ? "挑一个游戏，开始冒险" : "欢迎回来，继续上次的冒险"}
          </h1>
          {active && (
            <p className="mt-3 text-sm font-medium text-white/85 sm:text-base">
              {timeAgo(active.lastPlayedAt)}玩过 · 共玩了 {playTime(active.playedMs)}
            </p>
          )}
        </div>
        {/* Scrolling clips both axes; the vertical padding leaves room for the hover scale and focus ring. */}
        <ul className="-mx-6 -my-3 flex gap-3 overflow-x-auto px-6 py-3 [scrollbar-width:none] sm:-mx-10 sm:gap-5 sm:px-10">
          {games.map((g) => (
            <li key={g.id} className="shrink-0">
              <Link
                href={`/games/${g.id}`}
                className="group block w-18 text-center outline-none sm:w-22"
                onMouseEnter={() => show(g)}
                onFocus={() => show(g)}
                onBlur={() => setActive(null)}
              >
                <span
                  className="relative block aspect-square overflow-hidden rounded-xl shadow-lg transition-transform duration-200 group-hover:scale-105 group-focus-visible:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-white/60"
                  style={{ backgroundColor: artBackground(g, true) }}
                >
                  <GameArt game={g} kind="icon" />
                </span>
                <span className="mt-1.5 block truncate text-xs font-semibold text-white sm:text-sm [text-shadow:0_1px_6px_rgb(0_0_0/0.6)]">{g.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
