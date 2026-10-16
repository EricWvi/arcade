/** 造梦西游 2's role ids in its save files. */
const roles: Record<number, string> = { 1: "孙悟空", 2: "唐僧", 3: "八戒", 4: "沙僧", 5: "白龙" };

type Player = { roleid?: number; curLevel?: number };
type SaveFile = { playerNum?: number; player1_obj?: Player; player2_obj?: Player };

const describePlayer = (p?: Player) => (p ? `${roles[p.roleid ?? 0] ?? "角色"} Lv.${p.curLevel ?? 1}` : "");

/** "孙悟空 Lv.12", or both players for a two-player save. */
export function describeSave(data: string): string | undefined {
  try {
    const save = JSON.parse(data) as SaveFile;
    if (save.playerNum === 2) return `双人 · ${describePlayer(save.player1_obj)} / ${describePlayer(save.player2_obj)}`;
    return describePlayer(save.player1_obj) || undefined;
  } catch {
    return undefined;
  }
}
