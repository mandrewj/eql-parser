// The panel's own arithmetic — the few numbers the UI derives rather than receives.
// Kept out of the components so `node --test` can pin them without a DOM: these are
// exactly the rules that are easy to regress into a mean-of-means or a stray threshold.

import type { SelfEncounterPoint } from "./types";

/** Below this share of an encounter, a row's engaged window is worth flagging. Anything
 *  stricter lights up nearly every row — almost nobody engages on the mob's first second. */
export const PARTIAL_WINDOW = 0.7;

export const isPartialWindow = (activeSec: number, encounterSec: number) =>
  activeSec < encounterSec * PARTIAL_WINDOW;

/** Total damage ÷ total encounter seconds over the points given — the duration-weighted
 *  mean of the bars the chart draws, so a five-minute boss pulls on it harder than a
 *  four-second mob. Deliberately *not* the mean of each encounter's rate, which would
 *  weigh those two equally. Zero when the window is empty. */
export const weightedAvgDps = (points: SelfEncounterPoint[]): number => {
  let damage = 0;
  let seconds = 0;
  for (const p of points) {
    damage += p.damage;
    seconds += p.durationSec;
  }
  return seconds > 0 ? Math.round(damage / seconds) : 0;
};
