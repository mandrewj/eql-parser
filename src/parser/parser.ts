// Line parser: raw log line -> CombatEvent (or null for non-combat lines).
//
// Fast path: only lines containing one of these tokens can be combat-relevant,
// so we prefilter before running the (heavier) regexes.

import { CHARM_SPELL_RE } from "./spells.js";
import type {
  CharmEvent,
  CombatEvent,
  CritKind,
  DeathEvent,
  DotTickEvent,
  HealEvent,
  LoginEvent,
  LootEvent,
  OutputFileEvent,
  GivenEvent,
  TradeOfferEvent,
  TradeCompleteEvent,
  MeleeDamageEvent,
  MissEvent,
  PetEvent,
  ProgressEvent,
  SpellDamageEvent,
  StanceEvent,
  WhoEvent,
  ZoneEvent,
} from "../types.js";

const TIMESTAMP_RE =
  /^\[([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.*)$/;

const RELEVANT_RE =
  /damage|slain|but |assume |heal|Master|invocation|entered|LOADING|a level|ability|better at|experience|glaze|[Cc]harm|Beguile|Bewitching|ZONE: |looted|Outputfile|been given|You offered|complete the trade|Welcome to/;

// A `/who` result line — the only place the log states anyone's class:
//   [42 PAL/MNK/BRD] Sanluen (Wood Elf) <Guild Name> ZONE: Nagafen's Lair (soldungb)
// `ZONE: ` gates it in the prefilter above and is near-exact: 468 of the 469 lines carrying
// that token in a 785k-line log are who-lines. Characters here hold up to three classes, and
// a charm emote can only have come from one of them — which is the whole point of reading it.
const WHO_RE = /^\[(\d+) ([A-Z]{3}(?:\/[A-Z]{3})*)\] (\S+) \(/;

// An item kept from a corpse. The log has five loot forms and ~5,600 loot lines; only this one
// means "this is yours now" — the others end "and sold it for…" or "to create…". It is also the
// only form a mote ever appears in. Anchored at `--`, so the other 5,100 fail on two characters.
const LOOT_RE = /^--You have looted (?:an?|\d+) (.+?) from (.+?)'s corpse\.--$/;

// The **second** keeping form, and it looks nothing like the first: no `--` fence, no trailing
// full stop, and a different verb tense. An item routed straight into one of the game's
// auto-storages is announced this way instead:
//
//   You looted a Wind Rune Azia from a thunder spirit's corpse and stored it in your currency
//
// Three destinations occur in a real log — `currency`, `tradeskill depot` and `Dragon Hoard`.
// This matters well beyond tidiness: Plane of Sky **wind runes are routed to the currency tab**,
// so without this pattern every rune the character loots is invisible. The `and stored it in
// your` literal is what keeps the ~5,400 "and sold it for…" lines out, since they share the
// whole prefix up to the corpse.
const LOOT_STORED_RE =
  /^You looted (?:an?|\d+) (.+?) from (.+?)'s corpse and stored it in your (.+?)\.?$/;

// The game's confirmation that it has written an inventory export:
//   Outputfile Complete: Sanluen_freeport-Inventory.txt
// Not combat, and interesting to exactly one consumer — it is the cue to re-read the export
// rather than wait out the poll that would otherwise notice a few seconds later.
const OUTPUTFILE_RE = /^Outputfile Complete: (.+?)\s*$/;

// An item handed over by an NPC rather than taken from a corpse — what a completed turn-in
// looks like: `You have been given: Espri`. It is the only line that *dates* a quest
// completion; holding the reward says a quest is done, this says when. Rare (3 lines in 1.5M)
// and gated behind `been given` in the prefilter.
const GIVEN_RE = /^You have been given: (.+?)\s*$/;

// A trade, which is how a quest is handed in. The offer names the item and the count leaving
// your inventory; the completion is what says the trade went through rather than being
// cancelled, so the two are paired by the engine rather than acted on separately:
//
//   You offered 1 Wind Rune Dena to Torgon Blademaster.
//   You complete the trade with Torgon Blademaster.
//
// This is the only record that an item **left**. Nothing else in the log says so, which is why
// the Sky tracker's counts could only ever go up. Note the item carries its upgrade suffix
// (`High Quality Raiment +1`), which `sky.ts` folds away.
const TRADE_OFFER_RE = /^You offered (\d+) (.+?) to (.+?)\.$/;
const TRADE_DONE_RE = /^You complete the trade with (.+?)\.$/;

// The client entering the world — the only line that marks where a play session begins:
//   Welcome to EverQuest Legends!
// Nineteen in a 2M-line log, and the exact wording is stable across all of them (the classic
// "Welcome to EverQuest!" is allowed for too, since the two games share this message). It is the
// boundary the crit tracker's "this session" window is measured from; without it a session could
// only ever be a guess at a clock.
const LOGIN_RE = /^Welcome to EverQuest(?: Legends)?!$/;

// Zoning is a hard fight boundary: "You have entered The Greater Faydark."
// (guard against the non-zone "You have entered an area where …" warning).
const ZONE_RE = /^You have entered (?!an area\b)(.+?)\.$/;
// The other half of a zone transition, and the earlier one. A real log has 110 of these
// against 115 named arrivals, so the two do not pair up exactly — on its own this line still
// means "everything you were fighting is behind you", it just can't say where you now are.
const LOADING_RE = /^LOADING, PLEASE WAIT\.$/;

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

// --- the trailing flag ------------------------------------------------------
// Damage and heal lines can end with a parenthetical after the sentence terminator, and it is
// the only place the game says a hit critted. Every flag seen in a 2M-line log, by count:
//
//   Critical 26463 · Riposte 11231 · Flurry 977 · Slay Undead 363 · Rampage 236
//   Riposte Critical 159 · Finishing Blow 114 · Crippling Blow 112 · Strikethrough 32 · …
//
// Two things follow. **They compose** — `(Riposte Strikethrough Critical)` is a real line — so
// reading one is a search, not a match. And **three of them are crits that never say
// "Critical"**: Crippling Blow, Slay Undead and Finishing Blow are emitted in its place, never
// beside it, so counting only the literal word loses them. The self's own melee rate moves
// 8.24% → 8.32% on the strength of 107 Crippling Blows.
//
// The others describe how the swing resolved (Riposte, Strikethrough) or that it was an extra
// one (Flurry, Rampage, Double Bow Shot). Those are not critical hits and stay out.
const CRIT_KINDS: ReadonlyArray<readonly [RegExp, CritKind]> = [
  [/\bcritical\b/i, "critical"],
  [/\bcrippling blow\b/i, "crippling"],
  [/\bslay undead\b/i, "slay"],
  [/\bfinishing blow\b/i, "finishing"],
];

/** Classify a trailing flag, or undefined when there is none or it isn't a crit. */
function critKind(modifier: string | undefined): CritKind | undefined {
  if (!modifier) return undefined;
  for (const [re, kind] of CRIT_KINDS) if (re.test(modifier)) return kind;
  return undefined;
}

/** The crit half of an event, spread into it. Omitting `critKind` entirely on a non-crit keeps
 *  the event shape identical to before for the ~99% of lines that don't carry one. */
function critFields(modifier: string | undefined): { crit: boolean; critKind?: CritKind } {
  const kind = critKind(modifier);
  return kind ? { crit: true, critKind: kind } : { crit: false };
}

const STANCE_RE = /^You assume an? (.+?) stance\.$/;
// Caster "stances" are invocations: "You begin reciting the spellblade invocation."
const INVOKE_RE = /^You begin reciting the (.+?) invocation\.$/;
const YOU_SLAIN_RE = /^You have slain (.+?)!$/;
// My own death reads "have been", not "has been", so SLAIN_BY_RE never covers it.
const SELF_SLAIN_RE = /^You have been slain by (.+?)!$/;
const SLAIN_BY_RE = /^(.+?) has been slain by (.+?)!$/;
// `(?: on)?` catches the one phrasal verb in the set — "tries to frenzy on <mob>", 134 lines.
// Without it `\w+` stops at "frenzy" and the particle is swallowed by the target, which then
// reads "on orc taskmaster": an entity that exists nowhere else in the log. It never carries
// damage, so it stays out of the encounter tables, but it does reach the classifier — and a
// phantom NPC there can flip the mob that swung at it to *friendly* by the "attacked an NPC"
// rule. The damage form ("frenzies on") was always fine, since its verbs are a fixed list.
const MISS_YOU_RE = /^You try to (\w+(?: on)?) (.+?), but (.+?)!(?: \([^)]+\))?$/;
const MISS_OTHER_RE = /^(.+?) tries to (\w+(?: on)?) (.+?), but (.+?)!(?: \([^)]+\))?$/;
// DoT/nuke crits append " (Critical)" AFTER the sentence terminator, e.g.
// "… has taken 33 damage from Stinging Swarm by Orson. (Critical)".
//
// Two widenings, both found by clustering every unparsed line in a real log:
//   `ha(?:s|ve)` — a tick on *me* reads "You **have** taken", which the third-person form
//     cannot match. Same trap as "You have been slain by" (see the death patterns): 1,331
//     lines and 32,949 points of damage taken, previously invisible.
//   `from|by`   — 395 lines say "damage **by** <Spell>" and name no caster at all, among
//     them my own Chords of Dissonance and Denon's Disruptive Discord. `splitDotSource`
//     already yields "Unknown" for a source with no " by " inside it, which is the honest
//     answer here rather than a guess.
const DOT_RE = /^(.+?) ha(?:s|ve) taken (\d+) damage (?:from|by) (.+?)[.!](?: \(([^)]+)\))?$/;

// Damage to me from a source the line declines to name. Distinct from NONMELEE_RE, which
// needs "points of non-melee damage" and an owner; this form has neither.
const SELF_NONMELEE_RE = /^You were hit by non-melee for (\d+) damage\.$/;

// A damage shield that was fully absorbed: no damage, but a real swing's worth of
// avoidance. "<Target>'s magical skin absorbs the damage of <Owner> <effect>."
// (The sibling "absorbs the blow!" needs nothing — it arrives inside a "tries to …, but
// …!" line, which the miss patterns already read.)
const SHIELD_ABSORB_RE = /^(.+?)'s magical skin absorbs the damage of (.+?)\.$/;
// The flag is captured rather than skipped even though no non-melee line in a 2M-line log has
// ever carried one. That zero is a *measurement*, and the crit panel reports it as one — so the
// parser reads what the line says and lets the count be the evidence, instead of the pattern
// deciding the answer in advance.
const NONMELEE_RE =
  /^(.+?) (?:is|are|was|were) .+? by (.+?) for (\d+) points? of non-melee damage[.!](?: \(([^)]+)\))?$/;
// A named ability resolving as typed damage rather than a plain swing. That adjective sits
// exactly where the melee patterns require "points of damage" with nothing in between, which is
// why these went unparsed at first: 26,864 lines in a real log, 564,644 points of them the
// self's own. Anchoring on the literal " hit " is what splits a multi-word attacker correctly
// ("Ranshi`s warder hit …"); the verb is always "hit", the spell is always named, and
// "(Critical)" is the only flag.
//
// The element is `\w+`, not a list. It was magic/fire/cold/poison/disease/unresistable until a
// boss turned up dealing **chromatic** damage, and four lines went unparsed — the fixed list was
// a standing invitation to miss the next one. Nothing else can reach this pattern anyway: a
// plain swing has no adjective at all, and "non-melee" is hyphenated, so neither matches `\w+`,
// and both lack the trailing " by <Spell>".
const TYPED_DAMAGE_RE =
  /^(.+?) hit (.+?) for (\d+) points? of \w+ damage by (.+?)\.(?: \(([^)]+)\))?$/;

const MELEE_YOU_RE =
  /^You ([a-z]+) (.+?) for (\d+) points? of damage\.(?: \(([^)]+)\))?$/;
const MELEE_OTHER_RE = new RegExp(
  `^(.+?) (${MELEE_VERBS_3P}) (.+?) for (\\d+) points? of damage\\.(?: \\(([^)]+)\\))?$`,
);
// "<Healer> healed <target> [over time] for <eff> (<raw>) hit points [by <Spell>]." — with
// optional HoT phrase, effective/raw amounts, spell, and a trailing " (Critical)" flag.
const HEAL_RE =
  /^(.+?) (?:heals|healed) (.+?)(?: over time)? for (\d+)(?: \((\d+)\))? hit points(?: by (.+?))?[.!](?: \(([^)]+)\))?$/;

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
// Charm spell names live in `spells.ts`, transcribed from the wiki's class pages, because
// the same table has to agree with the landing-message table next to it.

/** Charm lines, tried last and only when a charm token is present. */
function parseCharm(tsMs: number, body: string): CharmEvent | null {
  const ev = (
    state: CharmEvent["state"],
    who: string,
    spell?: string,
    emote?: CharmEvent["emote"],
  ): CharmEvent => ({
    type: "charm",
    tsMs,
    raw: body,
    state,
    who: normName(who),
    ...(spell ? { spell } : {}),
    ...(emote ? { emote } : {}),
  });

  // Which message it is matters: it names the spell, and the spell names the caster's class.
  let m = CHARM_GLAZE_RE.exec(body);
  if (m) return ev("on", m[1]!, undefined, "glaze");

  m = CHARM_ON_RE.exec(body);
  if (m) return ev("on", m[1]!, undefined, "charmed");

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

  m = LOOT_RE.exec(body);
  if (m) {
    const ev: LootEvent = { type: "loot", tsMs, raw: body, item: m[1]!, from: m[2]! };
    return ev;
  }

  m = LOOT_STORED_RE.exec(body);
  if (m) {
    const ev: LootEvent = { type: "loot", tsMs, raw: body, item: m[1]!, from: m[2]!, storedIn: m[3]! };
    return ev;
  }

  m = OUTPUTFILE_RE.exec(body);
  if (m) {
    const ev: OutputFileEvent = { type: "outputfile", tsMs, raw: body, file: m[1]! };
    return ev;
  }

  m = GIVEN_RE.exec(body);
  if (m) {
    const ev: GivenEvent = { type: "given", tsMs, raw: body, item: m[1]! };
    return ev;
  }

  m = TRADE_OFFER_RE.exec(body);
  if (m) {
    const ev: TradeOfferEvent = {
      type: "tradeOffer", tsMs, raw: body,
      item: m[2]!, count: Number(m[1]), to: m[3]!,
    };
    return ev;
  }

  m = TRADE_DONE_RE.exec(body);
  if (m) {
    const ev: TradeCompleteEvent = { type: "tradeComplete", tsMs, raw: body, to: m[1]! };
    return ev;
  }

  // A `/who` line. Cheap and early: it can't be confused with anything else, and it is the
  // only line that ever tells us a player's class.
  m = WHO_RE.exec(body);
  if (m) {
    const ev: WhoEvent = {
      type: "who",
      tsMs,
      raw: body,
      name: m[3]!,
      level: Number(m[1]),
      classes: m[2]!.split("/"),
    };
    return ev;
  }

  // Entering the world. Not combat, and it must not open or extend a fight — it arrives while
  // the character is standing still on a loading screen.
  if (LOGIN_RE.test(body)) {
    const ev: LoginEvent = { type: "login", tsMs, raw: body };
    return ev;
  }

  // Zoning — ends all current encounters
  m = ZONE_RE.exec(body);
  if (m) {
    const ev: ZoneEvent = { type: "zone", tsMs, raw: body, zone: m[1]! };
    return ev;
  }
  if (LOADING_RE.test(body)) {
    // A transition with no name attached: it ends the fight but can't name the destination.
    const ev: ZoneEvent = { type: "zone", tsMs, raw: body, zone: null };
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

  // A damage shield fully absorbed — zero damage, so it is avoidance, not a damage event.
  m = SHIELD_ABSORB_RE.exec(body);
  if (m) {
    const { caster, effect } = splitOwner(m[2]!);
    const ev: MissEvent = {
      type: "miss",
      tsMs,
      raw: body,
      attacker: caster,
      target: normName(m[1]!),
      verb: effect,
      avoidance: "absorbed",
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
      ...critFields(m[6]),
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
      ...critFields(m[4]),
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
      form: "nonmelee",
      ...critFields(m[4]),
    };
    return ev;
  }

  // Damage to me whose source the log doesn't name. "Unknown" is the honest attacker —
  // it only ever appears on this side of a blow, so it never becomes a mob of its own.
  m = SELF_NONMELEE_RE.exec(body);
  if (m) {
    const ev: SpellDamageEvent = {
      type: "spell",
      tsMs,
      raw: body,
      owner: "Unknown",
      target: "You",
      effect: "non-melee",
      amount: Number(m[1]),
      form: "nonmelee",
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
      ...critFields(m[4]),
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
      ...critFields(m[5]),
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
      form: "ability",
      ...critFields(m[5]),
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
