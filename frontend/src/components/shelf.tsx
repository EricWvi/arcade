import { ChevronRight, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Link } from "wouter";

import { artBackground, GameArt } from "@/components/game-art";
import type { Game, Shelf as ShelfData } from "@/lib/api";

/** A category row of game cards that scrolls sideways, three cards per view on desktop. */
export function Shelf({ shelf }: { shelf: ShelfData }) {
  return (
    <section className="border-t pt-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{shelf.title}</h2>
        <Link href={`/categories/${shelf.id}`} className="flex items-center text-sm text-accent hover:underline">
          查看全部
          <ChevronRight className="size-4" />
        </Link>
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
  const [open, setOpen] = useState(false);

  return (
    <article>
      <button
        onClick={() => setOpen(true)}
        className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-2xl"
        style={{ backgroundColor: artBackground(game) }}
        aria-label={`${game.title}：查看介绍`}
        aria-haspopup="dialog"
      >
        <GameArt game={game} kind="card" />
      </button>
      <div className="mt-4 flex items-center gap-4">
        {/* The card art is the keyboard target; this just widens what a click opens. */}
        <div onClick={() => setOpen(true)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
          <GameIcon game={game} />
          <GameTitle game={game} />
        </div>
        <StartLink game={game} />
      </div>
      {open && <GameDetails game={game} onClose={() => setOpen(false)} />}
    </article>
  );
}

/**
 * A game's card opened over the page as a sheet that slides up from the
 * bottom: its art, title and description, and the same start button as on
 * the shelf. A long description runs below the window; scrolling lifts the
 * whole sheet. Escape, the close button or a click outside slides it back
 * down, then onClose unmounts it.
 */
function GameDetails({ game, onClose }: { game: Game; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // How far the sheet drops to leave the window, set on close; scrolling
  // may have lifted its top well above the window.
  const [closing, setClosing] = useState<number | null>(null);
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.showModal();
    // Opening focuses the close button while the sheet still sits below the
    // window, which scrolls the dialog to it; start from the top instead.
    d.scrollTop = 0;
  }, []);
  const close = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
    else setClosing(window.innerHeight - (sheet.current?.getBoundingClientRect().top ?? 0));
  };
  const paragraphs = (game.description || "暂无介绍。").split(/\n\s*\n/);

  return (
    // The dialog fills the window and scrolls; the sheet inside is the card.
    <dialog
      ref={dialog}
      aria-label={game.title}
      data-closing={closing !== null || undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="group m-0 h-svh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-transparent p-0 pt-[8svh] text-foreground [scrollbar-width:none] backdrop:bg-black/50 backdrop:backdrop-blur-sm backdrop:transition-opacity backdrop:duration-400 backdrop:ease-sheet starting:backdrop:opacity-0 data-closing:backdrop:opacity-0 data-closing:backdrop:duration-350 motion-reduce:backdrop:transition-none"
    >
      <div
        ref={sheet}
        onTransitionEnd={(e) => closing !== null && e.target === e.currentTarget && onClose()}
        style={closing === null ? undefined : ({ "--sheet-drop": `${closing}px` } as React.CSSProperties)}
        className="relative mx-auto min-h-[92svh] w-full max-w-[46.5rem] overflow-hidden rounded-t-3xl bg-background shadow-2xl transition-transform duration-400 ease-sheet group-data-closing:translate-y-(--sheet-drop) group-data-closing:duration-350 starting:translate-y-[100svh] motion-reduce:transition-none"
      >
        <button
          onClick={close}
          className="absolute top-4 right-4 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-black/40 text-white backdrop-blur-md"
          aria-label="关闭"
        >
          <X className="size-5" />
        </button>
        <div className="relative aspect-[16/10]" style={{ backgroundColor: artBackground(game) }}>
          <GameArt game={game} kind="card" />
        </div>
        <div className="space-y-10 px-6 pt-8 pb-24 sm:px-15">
          <div className="flex items-center gap-4 sm:gap-5">
            <GameIcon game={game} large />
            <GameTitle game={game} large />
            <StartLink game={game} large />
          </div>
          {/* Large like an iPad's reading text, with room for Chinese line spacing. */}
          <div className="space-y-8 text-[19px] leading-[1.7] sm:text-2xl sm:leading-[1.65]">
            {paragraphs.map((text, i) => (
              <p key={i} className="whitespace-pre-line">
                {text}
              </p>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** large sizes these up to sit above the open card's article. */
const GameIcon = ({ game, large = false }: { game: Game; large?: boolean }) => (
  <span
    className={`relative shrink-0 overflow-hidden ${large ? "size-16 rounded-2xl sm:size-20 sm:rounded-[1.25rem]" : "size-16 rounded-2xl"}`}
    style={{ backgroundColor: artBackground(game, true) }}
  >
    <GameArt game={game} kind="icon" />
  </span>
);

const GameTitle = ({ game, large = false }: { game: Game; large?: boolean }) => (
  <div className="min-w-0 flex-1">
    <h3 className={`truncate font-semibold ${large ? "text-xl sm:text-2xl" : "text-lg"}`}>{game.title}</h3>
    <p className={`truncate text-muted ${large ? "text-sm sm:text-base" : "text-sm"}`}>{game.subtitle}</p>
  </div>
);

const StartLink = ({ game, large = false }: { game: Game; large?: boolean }) => (
  <Link
    href={`/games/${game.id}`}
    className={`shrink-0 rounded-full bg-pill font-bold text-accent ${large ? "px-5 py-1.5 text-sm sm:px-6 sm:py-2 sm:text-base" : "px-5 py-1.5 text-sm"}`}
  >
    开始
  </Link>
);
