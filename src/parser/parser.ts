// Line parser: raw log line -> CombatEvent (or null for non-combat lines).
//
// Fast path: only lines containing one of these tokens can be combat-relevant,
// so we prefilter before running the (heavier) regexes.

import type {
  CharmEvent,
  CombatEvent,
  DeathEvent,
  DotTickEvent,
  HealEvent,
  MeleeDamageEvent,
  MissEvent,
  PetEvent,
  ProgressEvent,
  SpellDamageEvent,
  StanceEvent,
  ZoneEvent,
} from "../types.js";

const TIMESTAMP_RE =
  /^\[([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.*)$/;

const RELEVANT_RE =
  /damage|slain|but |assume |heal|Master|invocation|entered|a level|ability|better at|experience|glaze|[Cc]harm|Beguile|Bewitching/;

// Zoning is a hard fight boundary: "You have entered The Greater Faydark."
// (guard against the non-zone "You have entered an area where …" warning).
const ZONE_RE = /^You have entered (?!an area\b)(.+?)\.$/;

// A pet addressing you as "Master" only ever refers to *your* pet in your own log, so it
// identifies the self's pet. Two delivery verbs: this game sends pet chatter as `told you`
// ("A fire giant warrior told you, 'Attacking a fire giant warrior Master.'"), which is the
// only form a real 763k-line log contains — `says` is kept for the classic phrasing.
// `\bMaster\b` stays case-sensitive so "Orc taskmaster" can't false-positive, and the
// terminator allows the comma form ("I am unable to wake an imp protector, Master.").
const PET_SAY_RE = /^(.+?) (?:says|told you),? '.*\bMaster\b[.!]?'$/;

// Third-person melee verbs. Constraining the verb (vs. a bare \w+) is what lets
// a multi-word attacker like "Orc legionnaire" split correctly.
const MELEE_VERBS_3P =
  "hits|slashes|pierces|crushes|kicks|strikes|punches|bashes|backstabs|smites|cleaves|reaves|shoots|bites|claws|gores|mauls|stings|slams|smashes|slices|rends|gouges|frenzies on";

// Third-person → base, so "Feydie kicks" and "You kick" share one "kick" category.
const VERB_BASE: Record<string, string> = {
  hits: "hit", slashes: "slash", pierces: "pierce", crushes: "crush", kicks: "kick",
  strikes: "strike", punches: "punch", bashes: "bash", backstabs: "backstab", smites: "smite",
  cleaves: "cleave", reaves: "reave", shoots: "shoot", bites: "bite", claws: "claw", gores: "gore",
  mauls: "maul", stings: "sting", slams: "slam", smashes: "smash", slices: "slice", rends: "rend",
  gouges: "gouge", "frenzies on": "frenzy",
};
const baseVerb = (v: string): string => VERB_BASE[v] ?? v;

const STANCE_RE = /^You assume an? (.+?) stance\.$/;
// Caster "stances" are invocations: "You begin reciting the spellblade invocation."
const INVOKE_RE = /^You begin reciting the (.+?) invocation\.$/;
const YOU_SLAIN_RE = /^You have slain (.+?)!$/;
// My own death reads "have been", not "has been", so SLAIN_BY_RE never covers it.
const SELF_SLAIN_RE = /^You have been slain by (.+?)!$/;
const SLAIN_BY_RE = /^(.+?) has been slain by (.+?)!$/;
const MISS_YOU_RE = /^You try to (\w+) (.+?), but (.+?)!(?: \([^)]+\))?$/;
const MISS_OTHER_RE = /^(.+?) tries to (\w+) (.+?), but (.+?)!(?: \([^)]+\))?$/;
// DoT/nuke crits append " (Critical)" AFTER the sentence terminator, e.g.
// "… has taken 33 damage from Stinging Swarm by Orson. (Critical)".
const DOT_RE = /^(.+?) has taken (\d+) damage from (.+?)[.!](?: \([^)]+\))?$/;
const NONMELEE_RE =
  /^(.+?) (?:is|are|was|were) .+? by (.+?) for (\d+) points? of non-melee damage[.!](?: \([^)]+\))?$/;
// A named ability resolving as typed damage — magic/fire/cold/poison/disease/unresistable —
// rather than a plain swing. That adjective sits exactly where the melee patterns require
// "points of damage" with nothing in between, which is why these went unparsed: 26,864 lines
// in a real log, 564,644 points of them the self's own. Anchoring on the literal " hit " is
// what splits a multi-word attacker correctly ("Ranshi`s warder hit …"); across the whole log
// the verb is always "hit", the spell is always named, and "(Critical)" is the only flag.
const TYPED_DAMAGE_RE =
  /^(.+?) hit (.+?) for (\d+) points? of (?:magic|fire|cold|poison|disease|unresistable) damage by (.+?)\.(?: \(([^)]+)\))?$/;

const MELEE_YOU_RE =
  /^You ([a-z]+) (.+?) for (\d+) points? of damage\.(?: \(([^)]+)\))?$/;
const MELEE_OTHER_RE = new RegExp(
  `^(.+?) (${MELEE_VERBS_3P}) (.+?) for (\\d+) points? of damage\\.(?: \\(([^)]+)\\))?$`,
);
// "<Healer> healed <target> [over time] for <eff> (<raw>) hit points [by <Spell>]." — with
// optional HoT phrase, effective/raw amounts, spell, and a trailing " (Critical)" flag.
const HEAL_RE =
  /^(.+?) (?:heals|healed) (.+?)(?: over time)? for (\d+)(?: \((\d+)\))? hit points(?: by (.+?))?[.!](?: \([^)]+\))?$/;

// --- charm (a mob turned into someone's pet) --------------------------------
// Charm lines are ~0.07% of a real log, so the whole block sits behind one token
// test and is tried after every damage pattern — the hot path never runs these.
const CHARM_HINT_RE = /glaze|[Cc]harm|Beguile|Bewitching/;
// Two landing messages, both naming the mob and neither naming the caster.
const CHARM_GLAZE_RE = /^(.+?)'s eyes glaze over\.$/;
const CHARM_ON_RE = /^(.+?) has been charmed\.$/;
// The cast names the caster but not its target, which is why ownership is the
// engine's job: it pairs a landing with a charm cast a few seconds earlier.
const CHARM_CAST_RE = /^(.+?) begins? (?:casting|singing) (.+?)\.$/;
const CHARM_WORE_OFF_RE = /^Your (.+?) spell has worn off of (.+?)\.$/;
// A bard holds charm with a song, so the charm dies when the song does. This line
// names the song and no mob at all — it breaks every charm that song is holding.
const CHARM_FIZZLE_RE = /^You miss a note, bringing your (.+?) to a close!$/;
// Spell names that identify a charm. Verified against a real 742k-line log: Charm
// and Charm III, Beguile I–IV (enchanter), and Solon's Bewitching Bravura (bard).
// The rest are the classic-EQ charm family, listed so another class's charm isn't
// silently missed — an unlisted one still parses as a charm, it just lands without
// an owner, because only the *cast* line is matched against this.
const CHARM_SPELL_RE = /\b(?:charm|beguile|bewitching bravura|allure|cajoling|dominate)\b/i;

/** Charm lines, tried last and only when a charm token is present. */
function parseCharm(tsMs: number, body: string): CharmEvent | null {
  const ev = (state: CharmEvent["state"], who: string, spell?: string): CharmEvent => ({
    type: "charm",
    tsMs,
    raw: body,
    state,
    who: normName(who),
    ...(spell ? { spell } : {}),
  });

  let m = CHARM_GLAZE_RE.exec(body);
  if (m) return ev("on", m[1]!);

  m = CHARM_ON_RE.exec(body);
  if (m) return ev("on", m[1]!);

  // Only charm-named spells matter here; "You begin casting Healing." is not one.
  m = CHARM_CAST_RE.exec(body);
  if (m) return CHARM_SPELL_RE.test(m[2]!) ? ev("cast", m[1]!, m[2]!) : null;

  m = CHARM_WORE_OFF_RE.exec(body);
  if (m) return CHARM_SPELL_RE.test(m[1]!) ? ev("off", m[2]!, m[1]!) : null;

  m = CHARM_FIZZLE_RE.exec(body);
  if (m) return CHARM_SPELL_RE.test(m[1]!) ? ev("off", "", m[1]!) : null;

  return null;
}

// --- character progression (self only) --------------------------------------
const LEVEL_RE = /^You have gained a level! Welcome to level (\d+)!$/;
// Note the double space the game emits between the two sentences — \s+ absorbs it.
const AP_GAIN_RE = /^You have gained (\d+) ability point\(s\)!\s+You now have (\d+) ability point\(s\)\.$/;
const AA_BUY_RE = /^You have gained the ability "(.+?)" at a cost of (\d+) ability points?\.$/;
const AA_RANK_RE = /^You have improved (.+?) at a cost of (\d+) ability points?\.$/;
// Distinct from AA_BUY_RE: a *skill* becoming usable, not an alternate advancement.
const UNLOCK_RE = /^You have gained the ability to use (.+?)\.$/;
const SKILL_RE = /^You have become better at (.+?)! \((\d+)\)$/;
const XP_RE = /^You gain (?:party )?experience! \(([\d.]+)%\)$/;

/** "Mnemonic Retention 2" -> name + rank; a bare name is rank 1. */
function splitRank(name: string): { name: string; rank: number } {
  const m = /^(.+?) (\d+)$/.exec(name);
  return m ? { name: m[1]!, rank: Number(m[2]) } : { name, rank: 1 };
}

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

  // Stance change (self only) — melee stance or caster invocation
  let m = STANCE_RE.exec(body);
  if (m) {
    const ev: StanceEvent = { type: "stance", tsMs, raw: body, dim: "melee", stance: m[1]! };
    return ev;
  }
  m = INVOKE_RE.exec(body);
  if (m) {
    const ev: StanceEvent = { type: "stance", tsMs, raw: body, dim: "invocation", stance: m[1]! };
    return ev;
  }

  // Zoning — ends all current encounters
  m = ZONE_RE.exec(body);
  if (m) {
    const ev: ZoneEvent = { type: "zone", tsMs, raw: body, zone: m[1]! };
    return ev;
  }

  // Pet identifying itself ("... Master.") ⇒ it's the self's pet
  m = PET_SAY_RE.exec(body);
  if (m) {
    const ev: PetEvent = { type: "pet", tsMs, raw: body, pet: m[1]!, owner: "You" };
    return ev;
  }

  // Deaths (fight boundaries)
  m = YOU_SLAIN_RE.exec(body);
  if (m) {
    const ev: DeathEvent = { type: "death", tsMs, raw: body, victim: m[1]!, killer: "You" };
    return ev;
  }
  m = SELF_SLAIN_RE.exec(body);
  if (m) {
    const ev: DeathEvent = { type: "death", tsMs, raw: body, victim: "You", killer: m[1]! };
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

  // Typed ability damage sits after the melee patterns deliberately: melee is the biggest
  // group in the log by far (186k lines vs 27k), so it must not pay an extra regex to get
  // here. These lines can't be confused with a melee swing anyway — the type adjective is
  // precisely what the melee patterns refuse.
  m = TYPED_DAMAGE_RE.exec(body);
  if (m) {
    const ev: SpellDamageEvent = {
      type: "spell",
      tsMs,
      raw: body,
      owner: normName(m[1]!),
      target: normName(m[2]!),
      // The line names the real ability, so it needs no damage-message table to be readable.
      effect: m[4]!,
      amount: Number(m[3]),
      crit: m[5] ? /critical/i.test(m[5]) : false,
    };
    return ev;
  }

  // Charm and progression last: both are rare next to damage, so the hot path never
  // pays for them. One cheap token test gates each block.
  if (CHARM_HINT_RE.test(body)) {
    // Falls through rather than returning: an AA named for a charm spell is a
    // progression line that happens to carry a charm token.
    const charm = parseCharm(tsMs, body);
    if (charm) return charm;
  }
  if (/^You (?:have )?(?:gain|become|improved)/.test(body)) return parseProgress(tsMs, body);

  return null;
}

/** Level-ups, ability points, AAs, skill unlocks/ups, and xp ticks — all self-only. */
function parseProgress(tsMs: number, body: string): ProgressEvent | null {
  const ev = (fields: Omit<ProgressEvent, "type" | "tsMs" | "raw">): ProgressEvent => ({
    type: "progress",
    tsMs,
    raw: body,
    ...fields,
  });

  let m = LEVEL_RE.exec(body);
  if (m) return ev({ kind: "level", value: Number(m[1]) });

  m = AP_GAIN_RE.exec(body);
  if (m) return ev({ kind: "ap", value: Number(m[1]), total: Number(m[2]) });

  m = AA_BUY_RE.exec(body);
  if (m) return ev({ kind: "ability", name: m[1]!, value: Number(m[2]), rank: 1 });

  m = AA_RANK_RE.exec(body);
  if (m) {
    const { name, rank } = splitRank(m[1]!);
    return ev({ kind: "ability", name, rank, value: Number(m[2]) });
  }

  m = UNLOCK_RE.exec(body);
  if (m) return ev({ kind: "unlock", name: m[1]! });

  m = SKILL_RE.exec(body);
  if (m) return ev({ kind: "skill", name: m[1]!, value: Number(m[2]) });

  m = XP_RE.exec(body);
  if (m) return ev({ kind: "xp", value: Number(m[1]) });

  return null;
}
