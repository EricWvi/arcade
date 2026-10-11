import { ChevronRight } from "lucide-react";

import type { Game, Shelf as ShelfData } from "@/data/home";

/** A category row of game cards that scrolls sideways, three cards per view on desktop. */
export function Shelf({ shelf }: { shelf: ShelfData }) {
  return (
    <section className="border-t pt-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{shelf.title}</h2>
        <a href={`/categories/${shelf.id}`} className="flex items-center text-sm text-accent hover:underline">
          查看全部
          <ChevronRight className="size-4" />
        </a>
      </div>
      <ul className="-mx-4 grid snap-x snap-mandatory auto-cols-[85%] grid-flow-col gap-6 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:auto-cols-[calc((100%-1.5rem)/2)] sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:auto-cols-[calc((100%-3rem)/3)] lg:scroll-px-8 lg:px-8">
        {shelf.games.map((g) => (
          <li key={g.id} className="snap-start">
            <GameCard game={g} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GameCard({ game }: { game: Game }) {
  return (
    <article>
      {/* Card cover placeholder, 16:10. */}
      <a href={`/games/${game.id}`} className="block aspect-[16/10] rounded-2xl" style={{ backgroundColor: game.tint }} aria-label={game.title} />
      <div className="mt-4 flex items-center gap-4">
        {/* Icon placeholder. */}
        <span
          className="size-16 shrink-0 rounded-2xl"
          style={{ backgroundColor: `color-mix(in srgb, ${game.tint} 75%, black)` }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{game.title}</h3>
          <p className="truncate text-sm text-muted">{game.subtitle}</p>
        </div>
        <a href={`/games/${game.id}`} className="shrink-0 rounded-full bg-pill px-5 py-1.5 text-sm font-bold text-accent">
          开始
        </a>
      </div>
    </article>
  );
}
