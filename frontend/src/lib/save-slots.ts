import type { Saves } from "@/lib/api";

/*
 * File saves sit in a fixed set of slots. A save's name on the server is
 * "<slot>/<title>", so a save stays in its slot until saved over, and two
 * slots may share a title. Saves from before slots were moved into them
 * by a database migration; other names are not shown.
 */

export const slotCount = 6;

/** The server caps names at 200 bytes, and CJK takes 3 bytes a character. */
export const maxTitle = 50;

export type SlotSave = { name: string; title: string; data: string; updated: number };

/** Each slot's save, or undefined where the slot is empty. */
export type Slots = (SlotSave | undefined)[];

const slotted = /^([1-6])\/(.+)$/s;

export function toSlots(saves: Saves, updated: Record<string, number>): Slots {
  const slots: Slots = Array.from({ length: slotCount }, () => undefined);
  for (const [name, data] of Object.entries(saves)) {
    const [, number, title] = slotted.exec(name) ?? [];
    if (!title) continue;
    const slot = Number(number) - 1;
    const save = { name, title, data, updated: updated[name] ?? 0 };
    // Two tabs saving at once may both fill a slot; the newer wins.
    if ((slots[slot]?.updated ?? -1) < save.updated) slots[slot] = save;
  }
  return slots;
}

/** The changes that put data in slot under title, replacing what was there. */
export function writeSlot(slots: Slots, slot: number, title: string, data: string) {
  const changes: Record<string, string | null> = {};
  const old = slots[slot];
  if (old) changes[old.name] = null;
  changes[`${slot + 1}/${title}`] = data;
  return changes;
}

export const validTitle = (title: string) => title.length > 0 && title.length <= maxTitle && !/[\p{Cc}]/u.test(title);
