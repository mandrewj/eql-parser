// The panel's own arithmetic — the few numbers the UI derives rather than receives.
// Kept out of the components so `node --test` can pin them without a DOM: these are
// exactly the rules that are easy to regress into a mean-of-means or a stray threshold.

import type { CritAbility, CritCategoryStat, EncounterCard, SelfEncounterPoint } from "./types";

/** Below this share of an encounter, a row's engaged window is worth flagging. Anything
 *  stricter lights up nearly every row — almost nobody engages on the mob's first second. */
export const PARTIAL_WINDOW = 0.7;

export const isPartialWindow = (activeSec: number, encounterSec: number) =>
  activeSec < encounterSec * PARTIAL_WINDOW;

/** Rows an encounter table draws before it asks to be expanded. Six is what the engine used
 *  to send and what the 540px panel is sized for — enough that an ordinary group fight needs
 *  no interaction at all. */
export const VISIBLE_ROWS = 6;

/** Share of damage dealt, DPS as a tiebreak — the engine's own ranking, re-applied because
 *  the lead pulls my row up out of the tail and has to re-seat it in rank order. */
const byShare = (a: EncounterCard, b: EncounterCard) =>
  b.damage.total - a.damage.total || b.damage.perSec - a.damage.perSec;

/** How an encounter table splits a full contributor list: the rows it opens on, the tail it
 *  folds behind a click, and what that tail is worth as a share of the mob's damage.
 *
 *  My own row is always in the lead however far down the ranking it lands — on a night spent
 *  healing it is nowhere near the top, and a meter that cannot show you yourself without a
 *  click is worse than one that never had the rest. Everyone else follows in rank order.
 *
 *  The share is the number that says whether opening is worth it: four archers who each landed
 *  a shot and half a raid both read as "+n more" without it. It divides by the encounter total
 *  rather than the tail's own sum, so a fold's percentages are comparable between fights. */
export const foldEncounterCards = (
  cards: EncounterCard[],
  total: number,
  visible = VISIBLE_ROWS,
): { lead: EncounterCard[]; folded: EncounterCard[]; foldedTotal: number; foldedPct: number } => {
  const self = cards.find((c) => c.isSelf);
  const lead = [
    ...(self ? [self] : []),
    ...cards.filter((c) => !c.isSelf).slice(0, self ? visible - 1 : visible),
  ].sort(byShare);
  const folded = cards.filter((c) => !lead.includes(c));
  const foldedTotal = folded.reduce((s, c) => s + c.damage.total, 0);
  return { lead, folded, foldedTotal, foldedPct: total > 0 ? Math.round((foldedTotal / total) * 1000) / 10 : 0 };
};

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

// --- critical hits ---------------------------------------------------------

/** Below this many hits a percentage is mostly noise, so the panel marks it as thin rather
 *  than presenting it as a rate. Chosen from the shape of the data: at 100 hits an 8% rate
 *  is ±5 points at one standard error, which is the point where the number stops being a
 *  claim about the character and starts being a claim about the afternoon. */
export const THIN_SAMPLE = 100;

/** Crits ÷ hits, as a percentage. Null when there is nothing to divide, or when the form
 *  cannot crit at all — both print as "—", and neither is a zero. */
export const critRate = (c: { hits: number; crits: number; crittable?: boolean }): number | null =>
  c.crittable === false || c.hits === 0 ? null : (c.crits / c.hits) * 100;

/** The share of this category's output that arrived on a crit. Deliberately a second number
 *  next to the rate rather than a replacement for it: a crit lands about one swing in twelve
 *  but carries an eighth again of the damage, and only the pair says that. */
export const critShare = (c: { total: number; critTotal: number }): number | null =>
  c.total === 0 ? null : (c.critTotal / c.total) * 100;

/** Mean crit and mean ordinary hit, so the multiplier is readable. Null on either side when
 *  that side has no hits — a category with no crits has no average crit, and inventing one
 *  as 0 would make the multiplier below read as a nerf. */
export const critAverages = (c: {
  hits: number;
  crits: number;
  total: number;
  critTotal: number;
}): { crit: number | null; normal: number | null; multiple: number | null } => {
  const normalHits = c.hits - c.crits;
  const crit = c.crits > 0 ? c.critTotal / c.crits : null;
  const normal = normalHits > 0 ? (c.total - c.critTotal) / normalHits : null;
  return { crit, normal, multiple: crit !== null && normal !== null && normal > 0 ? crit / normal : null };
};

/** Whether a rate rests on too few hits to mean anything. A category that cannot crit is not
 *  "thin" — it has a definite answer, which is that there is no rate to give. */
export const isThinSample = (c: { hits: number; crittable?: boolean }): boolean =>
  c.crittable !== false && c.hits > 0 && c.hits < THIN_SAMPLE;

/** Below this many *crits*, the figures computed from crits alone — the damage share and the
 *  multiplier against a normal hit — are one or two rolls wide. Separate from `THIN_SAMPLE`
 *  because they have a different denominator: a spell cast 15,000 times has a perfectly solid
 *  crit rate and a meaningless average crit if only five of them landed. */
export const THIN_CRITS = 20;

/** Whether the crit-only figures rest on too few crits to read. */
export const isThinCrits = (c: { crits: number }): boolean => c.crits > 0 && c.crits < THIN_CRITS;

/** The abilities worth a row. Everything that has ever critted, plus anything used enough that
 *  its *absence* of crits is the finding — a spell cast 400 times without one is information,
 *  a proc that fired twice is not. */
export const shownAbilities = (cat: CritCategoryStat): CritAbility[] =>
  cat.abilities.filter((a) => a.crits > 0 || a.hits >= THIN_SAMPLE);
