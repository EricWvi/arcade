/*
 * What the generic game page cannot know about particular games, by game
 * key. Most games need nothing here.
 */
import * as zmxy1 from "@/games/zmxy-1";

/** Sums up a save file's contents for the save list, if the game can. */
export const describeSave: Record<string, (data: string) => string | undefined> = {
  "zmxy-1": zmxy1.describeSave,
};
