import type { Game, ImageKind, Shelf } from "@/lib/api";

/** URLs of a game image and of its blurred placeholder, by the game's key. */
export const gameImage = (id: string, kind: ImageKind) => ({
  src: `/games/${id}/imgs/${kind}.png`,
  placeholder: `/games/${id}/imgs/${kind}.blur.webp`,
});

/*
 * Mock data below stands in until it has a real source: recently played
 * will come from each user's history, and these shelves will move to
 * games.yaml once their games exist. Mock games have no images; `tint`
 * stands in for them.
 */
const game = (id: string, title: string, subtitle: string, tint: string): Game => ({
  id,
  title,
  subtitle,
  tint,
  images: [],
});

export const recentlyPlayed: Game[] = [
  game("pixel-island", "像素冒险岛", "动作冒险", "#4f8a3c"),
  game("mushroom", "蘑菇大冒险", "横版冒险", "#d4553a"),
  game("shovel-knight", "铲子骑士", "平台跳跃", "#2f5fa8"),
  game("pvz", "植物大战僵尸", "策略塔防", "#6aa84f"),
  game("angry-birds", "愤怒的小鸟", "物理解谜", "#c73a3a"),
  game("megaman-x", "洛克人X", "动作射击", "#2c7fc9"),
];

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
