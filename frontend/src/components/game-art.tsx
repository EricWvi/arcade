import { BlurImage } from "@/components/blur-image";
import { gameImage } from "@/data/home";
import type { Game, ImageKind } from "@/lib/api";

/**
 * Fills its positioned parent with one of the game's images, if the game
 * has it; otherwise the parent's own background shows.
 */
export function GameArt({ game, kind, className = "" }: { game: Game; kind: ImageKind; className?: string }) {
  const version = game.images[kind];
  if (!version) return null;
  const { src, placeholder } = gameImage(game.id, kind, version);
  return <BlurImage src={src} placeholder={placeholder} alt="" className={`absolute inset-0 ${className}`} />;
}

/** Background for a box that holds GameArt: the mock tint, or a neutral surface. */
export const artBackground = (game: Game, darken = false) =>
  game.tint ? (darken ? `color-mix(in srgb, ${game.tint} 75%, black)` : game.tint) : "var(--surface)";
