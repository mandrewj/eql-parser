// Spell reference data, transcribed from the EverQuest Legends wiki
// (https://eqlwiki.com/Category:Spells — each spell page carries a "Cast on Other Message").
//
// Only what the parser can actually act on lives here. The log states an ability's element
// inline for typed damage ("… for 151 points of *magic* damage by Smiting Strike"), so no
// table is needed to classify those; what the log never states is **who owns a charm**, and
// that is what this file exists to recover.
//
// The three damage-shield messages (thorns/flames/frost) and their elements are recorded in
// LOG_FORMAT.md rather than here: nothing reads them, and a table no code consults is a
// liability that drifts rather than a reference that helps.

/** A class abbreviation as it appears in a `/who` line: `[42 PAL/MNK/BRD] Sanluen (Wood Elf)`. */
export type ClassCode =
  | "BRD" | "BST" | "CLR" | "DRU" | "ENC" | "MAG" | "MNK"
  | "NEC" | "PAL" | "RNG" | "SHD" | "SHM" | "WAR" | "WIZ" | "BER" | "ROG";

/** A charm landing, keyed by the emote the mob makes. The log never names the caster on
 *  these lines, but the *message* identifies the spell, and the spell identifies the class —
 *  so a group with exactly one member of that class has exactly one candidate charmer.
 *
 *  Verified against the wiki's "Cast on Other Message" field, with "Someone" standing in for
 *  the mob's name. Only the two forms a real log actually contains are listed: `blinks` and
 *  `moans` (the Druid/Shaman and Necromancer charms) appear **zero** times in 785k lines, and
 *  both are generic enough to fire on ordinary ambient emotes, so listing them would risk
 *  inventing pets for no observed benefit. Add them if a log ever shows them. */
export interface CharmEmote {
  /** The spells that produce it — all of one class, which is what makes the inference work. */
  spells: string[];
  casters: ClassCode[];
}

export const CHARM_EMOTES: Record<"charmed" | "glaze", CharmEmote> = {
  // "<mob> has been charmed."
  charmed: { spells: ["Charm", "Beguile", "Cajoling Whispers"], casters: ["ENC"] },
  // "<mob>'s eyes glaze over."
  glaze: { spells: ["Solon's Bewitching Bravura"], casters: ["BRD"] },
};

/** Spell names that identify a charm *cast* (`X begins casting Charm III.`). Levels of the
 *  same line are numbered, so this matches on the stem. Sourced from the class pages:
 *  Enchanter (Charm/Beguile/Cajoling Whispers), Bard (Solon's Bewitching Bravura), Druid and
 *  Shaman (Befriend Animal, Charm Animals, Beguile Animals/Plants), Necromancer (Dominate
 *  Undead, Beguile Undead). */
export const CHARM_SPELL_RE =
  /\b(?:charm|beguile|bewitching bravura|cajoling whispers|befriend animal|dominate undead)\b/i;
