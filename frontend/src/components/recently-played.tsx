import { useState } from "react";

import defaultPoster from "@/assets/default-poster.webp";
import type { Game } from "@/data/home";

/**
 * The hero banner. Its background is the site poster until a game is
 * hovered or focused, then that game's poster.
 */
export function RecentlyPlayed({ games }: { games: Game[] }) {
  const [active, setActive] = useState<Game | null>(null);

  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl bg-[#3a2a6b] transition-colors duration-500"
      style={active ? { backgroundColor: active.tint } : undefined}
      onMouseLeave={() => setActive(null)}
    >
      <img
        src={defaultPoster}
        alt=""
        className="absolute inset-0 -z-20 size-full object-cover transition-opacity duration-500"
        style={{ opacity: active ? 0 : 1 }}
      />
      {/* Keeps the white headline and tile names readable over any poster. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-black/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="flex min-h-[360px] flex-col justify-between gap-10 p-6 sm:min-h-[480px] sm:p-10">
        <div className="text-white">
          <p className="text-sm font-semibold text-white/80">最近游玩</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">{active ? active.title : "欢迎回来，继续上次的冒险"}</h1>
        </div>
        <ul className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] sm:-mx-10 sm:gap-5 sm:px-10">
          {games.map((g) => (
            <li key={g.id} className="shrink-0">
              <a
                href={`/games/${g.id}`}
                className="group block w-20 text-center outline-none sm:w-24"
                onMouseEnter={() => setActive(g)}
                onFocus={() => setActive(g)}
                onBlur={() => setActive(null)}
              >
                <span
                  className="block aspect-square rounded-xl border-2 border-white/90 shadow-lg transition-transform duration-200 group-hover:scale-105 group-focus-visible:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-white/60"
                  style={{ backgroundColor: g.tint }}
                />
                <span className="mt-1.5 block truncate text-xs font-semibold text-white sm:text-sm">{g.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
