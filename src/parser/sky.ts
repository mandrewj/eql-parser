// Matching the Plane of Sky catalogue against what the game actually writes.
//
// The catalogue in `sky-catalogue.ts` carries the wiki's spelling; the inventory export and the
// log carry the game's. They disagree in three ways, all of them mechanical:
//
//   - **Apostrophes.** The game writes a backtick (``Spiroc Elder`s Totem``), the wiki a straight
//     quote, and either can arrive as a typographic one.
//   - **Upgrade suffixes.** EQL appends `+N` to an upgraded item and `(Exaltation)` to an
//     exalted copy. Both name the *same* item — the inventory gives them the same item id, which
//     is what proves this rather than assumes it — so both are stripped before matching.
//   - **Capitalisation.** The wiki has `Crown Of Elemental Mastery`; the game has `of`.
//
// Everything here is therefore keyed by a normalised form, and the catalogue's spelling is what
// gets displayed. A name is tracked whether it is a component, a rune or a reward, so one lookup
// answers "is this line worth recording" for every kind of Sky item at once.

import { SKY_CLASSES } from "./sky-catalogue.js";

/** What a tracked name is *for*. The three sets are disjoint across the whole catalogue, so a
 *  name maps to exactly one role and the engine never has to disambiguate. */
export type SkyItemRole = "component" | "rune" | "reward";

export interface SkyItemRef {
  /** The catalogue's spelling — what the UI prints. */
  name: string;
  role: SkyItemRole;
}

/** Fold a name to its matching key: strip upgrade suffixes, unify apostrophes, lowercase.
 *  Exported because the inventory parser and the tests need exactly this fold, and a second
 *  implementation of it is the obvious way for the two sides to drift apart. */
export function normalizeItemName(raw: string): string {
  return raw
    .replace(/[`‘’ʼ]/g, "'")
    .replace(/\s*\(Exaltation\)\s*$/i, "")
    .replace(/\s*\+\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const BY_KEY = new Map<string, SkyItemRef>();

function register(name: string, role: SkyItemRole): void {
  const key = normalizeItemName(name);
  // First writer wins. The catalogue has no cross-role collisions today (verified by test), so
  // this only ever collapses the same name repeated across classes — `Efreeti Standard` is a
  // component for both a Berserker and a Cleric quest.
  if (!BY_KEY.has(key)) BY_KEY.set(key, { name, role });
}

for (const cls of SKY_CLASSES) {
  for (const quest of cls.quests) {
    register(quest.rune, "rune");
    for (const item of quest.items) register(item.name, "component");
    for (const reward of quest.rewards) register(reward, "reward");
  }
}

/** The catalogue entry a game-written name refers to, or null when it is not a Sky item.
 *  This is the hot path — every loot line in the log goes through it — so it is one
 *  normalisation and one map hit, with no scanning of the catalogue. */
export function matchSkyItem(raw: string): SkyItemRef | null {
  return BY_KEY.get(normalizeItemName(raw)) ?? null;
}

/** Every tracked name, catalogue spelling. Used by the tests and by the inventory scan. */
export function skyItemNames(): SkyItemRef[] {
  return [...BY_KEY.values()];
}
