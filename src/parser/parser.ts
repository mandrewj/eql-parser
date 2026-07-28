// Line parser: raw log line -> CombatEvent (or null for non-combat lines).
//
// Fast path: only lines containing one of these tokens can be combat-relevant,
// so we prefilter before running the (heavier) regexes.

import type {
  CombatEvent,
  DeathEvent,
  DotTickEvent,
  HealEvent,
  MeleeDamageEvent,
  MissEvent,
  SpellDamageEvent,
  StanceEvent,
} from "../types.js";

const TIMESTAMP_RE =
  /^\[([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.*)$/;

const RELEVANT_RE = /damage|slain|but |assume |heal/;

// Third-person melee verbs. Constraining the verb (vs. a bare \w+) is what lets
// a multi-word attacker like "Orc legionnaire" split correctly.
const MELEE_VERBS_3P =
  "hits|slashes|pierces|crushes|kicks|strikes|punches|bashes|backstabs|smites|cleaves|bites|claws|gores|mauls|stings|slams|smashes|slices|rends|gouges|frenzies on";

// Third-person → base, so "Feydie kicks" and "You kick" share one "kick" category.
const VERB_BASE: Record<string, string> = {
  hits: "hit", slashes: "slash", pierces: "pierce", crushes: "crush", kicks: "kick",
  strikes: "strike", punches: "punch", bashes: "bash", backstabs: "backstab", smites: "smite",
  cleaves: "cleave", bites: "bite", claws: "claw", gores: "gore", mauls: "maul", stings: "sting",
  slams: "slam", smashes: "smash", slices: "slice", rends: "rend", gouges: "gouge", "frenzies on": "frenzy",
};
const baseVerb = (v: string): string => VERB_BASE[v] ?? v;

const STANCE_RE = /^You assume an? (.+?) stance\.$/;
const YOU_SLAIN_RE = /^You have slain (.+?)!$/;
const SLAIN_BY_RE = /^(.+?) has been slain by (.+?)!$/;
const MISS_YOU_RE = /^You try to (\w+) (.+?), but (.+?)!(?: \([^)]+\))?$/;
const MISS_OTHER_RE = /^(.+?) tries to (\w+) (.+?), but (.+?)!(?: \([^)]+\))?$/;
const DOT_RE = /^(.+?) has taken (\d+) damage from (.+?)(?: \(([^)]+)\))?[.!]$/;
const NONMELEE_RE =
  /^(.+?) (?:is|are|was|were) .+? by (.+?) for (\d+) points? of non-melee damage[.!]$/;
const MELEE_YOU_RE =
  /^You ([a-z]+) (.+?) for (\d+) points? of damage\.(?: \(([^)]+)\))?$/;
const MELEE_OTHER_RE = new RegExp(
  `^(.+?) (${MELEE_VERBS_3P}) (.+?) for (\\d+) points? of damage\\.(?: \\(([^)]+)\\))?$`,
);
// "<Healer> healed <target> for <eff> (<raw>) hit points [by <Spell>]." (raw/spell optional)
const HEAL_RE = /^(.+?) (?:heals|healed) (.+?) for (\d+)(?: \((\d+)\))? hit points(?: by (.+?))?[.!]$/;

/** Canonicalize the self-references (You/YOU/Your/YOUR) to a single "You" token. */
function normName(name: string): string {
  return /^your?$/i.test(name) ? "You" : name;
}

/** "YOUR flames" | "Marrowbane's flames" | "the frost" -> caster + effect. */
function splitOwner(mid: string): { caster: string; effect: string } {
  if (/^your\s+/i.test(mid)) return { caster: "You", effect: mid.replace(/^your\s+/i, "") };
  const m = /^(.+?)'s\s+(.+)$/.exec(mid);
  if (m) return { caster: m[1]!, effect: m[2]! };
  return { caster: "Unknown", effect: mid };
}

/** Resolve a heal target: reflexive pronouns map to the healer; You/you to self. */
function resolveHealTarget(target: string, healer: string): string {
  if (/^(?:himself|herself|itself|themselves)$/i.test(target)) return healer;
  return normName(target);
}

/** "your Chords of Dissonance III" | "Tainted Breath by Frogorson" -> spell + caster. */
function splitDotSource(rest: string): { caster: string; spell: string } {
  if (/^your\s+/i.test(rest)) return { caster: "You", spell: rest.replace(/^your\s+/i, "") };
  const m = /^(.+)\s+by\s+(.+)$/.exec(rest); // greedy: split at the last " by "
  if (m) return { spell: m[1]!, caster: m[2]! };
  return { caster: "Unknown", spell: rest };
}

/** Split a raw line into its timestamp (ms) and body, or null if not a log line. */
export function splitLine(raw: string): { tsMs: number; body: string } | null {
  const m = TIMESTAMP_RE.exec(raw.replace(/\r$/, ""));
  if (!m) return null;
  const tsMs = Date.parse(m[1]!.replace(/ +/g, " ")); // collapse space-padded day
  if (Number.isNaN(tsMs)) return null;
  return { tsMs, body: m[2]! };
}

/** Parse one raw log line into a CombatEvent, or null if not combat-relevant. */
export function parseLine(raw: string): CombatEvent | null {
  const split = splitLine(raw);
  if (!split) return null;
  const { tsMs, body } = split;
  if (!RELEVANT_RE.test(body)) return null;

  // Stance change (self only)
  let m = STANCE_RE.exec(body);
  if (m) {
    const ev: StanceEvent = { type: "stance", tsMs, raw: body, stance: m[1]! };
    return ev;
  }

  // Deaths (fight boundaries)
  m = YOU_SLAIN_RE.exec(body);
  if (m) {
    const ev: DeathEvent = { type: "death", tsMs, raw: body, victim: m[1]!, killer: "You" };
    return ev;
  }
  m = SLAIN_BY_RE.exec(body);
  if (m) {
    const ev: DeathEvent = {
      type: "death",
      tsMs,
      raw: body,
      victim: normName(m[1]!),
      killer: normName(m[2]!),
    };
    return ev;
  }

  // Misses / avoidance
  m = MISS_YOU_RE.exec(body);
  if (m) {
    const ev: MissEvent = {
      type: "miss",
      tsMs,
      raw: body,
      attacker: "You",
      target: normName(m[2]!),
      verb: m[1]!,
      avoidance: m[3]!,
    };
    return ev;
  }
  m = MISS_OTHER_RE.exec(body);
  if (m) {
    const ev: MissEvent = {
      type: "miss",
      tsMs,
      raw: body,
      attacker: normName(m[1]!),
      target: normName(m[3]!),
      verb: m[2]!,
      avoidance: m[4]!,
    };
    return ev;
  }

  // Healing
  m = HEAL_RE.exec(body);
  if (m) {
    const healer = normName(m[1]!);
    const ev: HealEvent = {
      type: "heal",
      tsMs,
      raw: body,
      healer,
      target: resolveHealTarget(m[2]!, healer),
      amount: Number(m[3]), // effective
      ...(m[4] ? { attempted: Number(m[4]) } : {}),
      ...(m[5] ? { spell: m[5] } : {}),
    };
    return ev;
  }

  // Damage-over-time ticks (best source of real spell names)
  m = DOT_RE.exec(body);
  if (m) {
    const { caster, spell } = splitDotSource(m[3]!);
    const ev: DotTickEvent = {
      type: "dot",
      tsMs,
      raw: body,
      caster: normName(caster),
      target: normName(m[1]!),
      spell,
      amount: Number(m[2]),
    };
    return ev;
  }

  // Spell / proc direct damage ("non-melee")
  m = NONMELEE_RE.exec(body);
  if (m) {
    const { caster, effect } = splitOwner(m[2]!);
    const ev: SpellDamageEvent = {
      type: "spell",
      tsMs,
      raw: body,
      owner: normName(caster),
      target: normName(m[1]!),
      effect,
      amount: Number(m[3]),
    };
    return ev;
  }

  // Melee — you as attacker
  m = MELEE_YOU_RE.exec(body);
  if (m) {
    const ev: MeleeDamageEvent = {
      type: "melee",
      tsMs,
      raw: body,
      attacker: "You",
      target: normName(m[2]!),
      verb: baseVerb(m[1]!),
      amount: Number(m[3]),
      crit: m[4] ? /critical/i.test(m[4]) : false,
      ...(m[4] ? { modifier: m[4] } : {}),
    };
    return ev;
  }

  // Melee — someone/something else as attacker
  m = MELEE_OTHER_RE.exec(body);
  if (m) {
    const ev: MeleeDamageEvent = {
      type: "melee",
      tsMs,
      raw: body,
      attacker: normName(m[1]!),
      target: normName(m[3]!),
      verb: baseVerb(m[2]!),
      amount: Number(m[4]),
      crit: m[5] ? /critical/i.test(m[5]) : false,
      ...(m[5] ? { modifier: m[5] } : {}),
    };
    return ev;
  }

  return null;
}
