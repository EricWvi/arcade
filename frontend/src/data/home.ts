import type { Catalog, Game, ImageKind, Shelf, Swf } from "@/lib/api";

/**
 * URLs of a game image and of its blurred placeholder, by the game's key.
 * The version from the catalogue changes with the files, so the server
 * lets browsers cache these URLs forever.
 */
export const gameImage = (id: string, kind: ImageKind, version: string) => ({
  src: `/games/${id}/imgs/${kind}.png?v=${version}`,
  placeholder: `/games/${id}/imgs/${kind}.blur.webp?v=${version}`,
});

/**
 * URL of a game's movie, and the base its own relative loads (levels and
 * such) resolve against: the movie's directory.
 */
export const gameSource = (id: string, swf: Swf) => {
  const dir = `/games/${id}/sources/`;
  const file = swf.file.split("/").map(encodeURIComponent).join("/");
  return { url: `${dir}${file}?v=${swf.version}`, base: dir + file.slice(0, file.lastIndexOf("/") + 1) };
};

/*
 * Mock shelves stand in until their games exist; then they move to
 * games.yaml. Mock games have no images; `tint` stands in for them.
 */
const game = (id: string, title: string, subtitle: string, tint: string): Game => ({
  id,
  title,
  subtitle,
  tint,
  images: {},
});

/** Shown after the shelves from games.yaml. */
export const mockShelves: Shelf[] = [
  {
    id: "classics",
    title: "经典合集",
    games: [
      game("freecell", "空当接龙", "经典桌面游戏", "#1f7a3e"),
      game("minesweeper", "扫雷", "经典桌面游戏", "#9a9ea6"),
      game("pinball", "三维弹球", "经典桌面游戏", "#3b2f6e"),
      game("chess", "国际象棋", "经典桌面游戏", "#8a5a35"),
      game("spider", "蜘蛛纸牌", "经典桌面游戏", "#2a8a4a"),
    ],
  },
  {
    id: "action",
    title: "动作冒险",
    games: [
      game("hero-road", "勇者之路", "动作冒险", "#5c9a3c"),
      game("adventure-island", "冒险岛", "横版冒险", "#e0803a"),
      game("metal-slug", "合金弹头", "射击动作", "#8a7a4a"),
      game("tmnt", "忍者神龟", "动作冒险", "#2e4a7a"),
      game("rayman", "雷曼", "平台冒险", "#4a9ad6"),
    ],
  },
];

/** Every shelf the home page shows: games.yaml first, then the mock ones. */
export const allShelves = (catalog?: Catalog): Shelf[] => [...(catalog?.shelves ?? []), ...mockShelves];

/** Finds a game on any shelf. */
export function findGame(shelves: Shelf[], id: string): Game | undefined {
  for (const s of shelves) {
    const game = s.games.find((g) => g.id === id);
    if (game) return game;
  }
}

/** Up to `limit` other games, those sharing a shelf with `game` first. */
export function moreGames(shelves: Shelf[], game: Game, limit = 6): Game[] {
  const sharing = shelves.filter((s) => s.games.some((g) => g.id === game.id));
  const ordered = [...sharing, ...shelves.filter((s) => !sharing.includes(s))].flatMap((s) => s.games);
  const seen = new Set([game.id]);
  return ordered.filter((g) => !seen.has(g.id) && seen.add(g.id)).slice(0, limit);
}
