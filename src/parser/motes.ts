// Mote reference data: the upgrade-material ladder, and the zone difficulty a drop came from.
//
// Both are game facts rather than parsing rules, so they live here next to `spells.ts` instead
// of being spelled out inside the engine.

/** The eight tiers, weakest first. The item is `Mote of <Tier> Potential` — except the middle
 *  rung, which the game names bare (`Mote of Potential`), so the tier word is optional in the
 *  pattern and `potential` is what an absent one means. */
export const MOTE_TIERS = [
  "infinitesimal",
  "minor",
  "lesser",
  "potential",
  "major",
  "greater",
  "superior",
  "ascendant",
] as const;

export type MoteTier = (typeof MOTE_TIERS)[number];

const MOTE_ITEM_RE = /^Mote of (?:(\w+) )?Potential$/i;

/** The tier of a looted item, or null when it isn't a mote at all. */
export function moteTier(item: string): MoteTier | null {
  const m = MOTE_ITEM_RE.exec(item.trim());
  if (!m) return null;
  const word = (m[1] ?? "potential").toLowerCase();
  return (MOTE_TIERS as readonly string[]).includes(word) ? (word as MoteTier) : null;
}

/** Title case for display: the log's own capitalisation, without re-deriving it per render. */
export const moteLabel = (tier: MoteTier): string => tier.charAt(0).toUpperCase() + tier.slice(1);

/** Zone difficulty, read off the suffix the game appends to instanced zone names —
 *  `Nagafen's Lair 2 (Adaptive)`. A zone with no suffix is the normal, un-named version.
 *  Verified against every zone line in a real log: those four words are the only suffixes
 *  that appear. */
export const DIFFICULTY_LABELS = ["D0", "D1", "D2", "D3", "D4"] as const;
export const DIFFICULTY_NAMES = ["normal", "Awakened", "Adaptive", "Fused", "Refined"] as const;

const SUFFIX_TO_DIFFICULTY: Record<string, number> = {
  awakened: 1,
  adaptive: 2,
  fused: 3,
  refined: 4,
};

/** 0–4 for a known zone, or null when we have not seen a zone line yet — which is not the same
 *  as D0, and is why the grid counts it separately rather than quietly calling it normal. */
export function zoneDifficulty(zone: string | null): number | null {
  if (zone === null) return null;
  const m = /\(([A-Za-z]+)\)\s*$/.exec(zone);
  if (!m) return 0; // no suffix at all — the plain, un-instanced zone
  return SUFFIX_TO_DIFFICULTY[m[1]!.toLowerCase()] ?? 0;
}
