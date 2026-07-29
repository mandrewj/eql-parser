# EverQuest Legends log format

All examples below are **real lines** taken from `eqlog_Sanluen_qeynos.txt`.
The file is ASCII with **CRLF (`\r\n`)** line endings, one event per line, appended live.

## Line envelope

Every line is a timestamp prefix + body:

```
[Sat Jul 18 01:49:02 2026] Feydie kicks orc legionnaire for 18 points of damage.
└──────────── timestamp ─────────┘ └──────────────── body ────────────────────┘
```

Regex:

```
^\[(?<ts>[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (?<body>.*)$
```

- Format is `EEE MMM d HH:mm:ss yyyy`. **Single-digit days are space-padded** (`Jul  5`), so allow `+` (one or more) spaces before the day number.
- Timestamps are **whole-second resolution** — multiple events share a second. DPS must bucket by second and never divide by zero-length windows.

## The "self" character

The logging character always appears as **`You` / `YOUR` / `YOU`**, never by name. The real
name comes from the filename: `eqlog_<Char>_<server>.txt` → here `Sanluen` on `qeynos`.
Map `You` → `Sanluen` for display. Everyone else appears by name (`Feydie`, `Frogorson`, …).

## Damage events (the DPS-relevant ones)

### 1. Melee — you as attacker
```
[..] You strike orc legionnaire for 50 points of damage.
[..] You crush royal guard for 18 points of damage. (Critical)
```
```
^You (?<verb>\w+) (?<target>.+?) for (?<amount>\d+) points? of damage\.(?: \((?<mod>[^)]+)\))?$
```
Note: your form uses the **base verb** (`strike`, `crush`); third person uses the **+s** form (`strikes`, `crushes`).

### 2. Melee — someone/something else as attacker
```
[..] Feydie kicks orc legionnaire for 18 points of damage.
[..] Feydie kicks orc centurion for 23 points of damage. (Critical)
[..] Orc legionnaire hits Feydie for 17 points of damage.   ← mob attacking a player
```
```
^(?<attacker>.+?) (?<verb>hits|slashes|pierces|crushes|kicks|strikes|punches|bashes|bites|claws|gores|mauls|stings|slams|backstabs) (?<target>.+?) for (?<amount>\d+) points? of damage\.(?: \((?<mod>[^)]+)\))?$
```
Because the same shape covers *player→mob* and *mob→player*, classify by **who is a known
player/pet vs. an NPC** (see "Entity classification"). Only player/pet → NPC damage counts toward DPS.

### 3. Spell / proc direct damage ("non-melee")
```
[..] Orc taskmaster is burned by YOUR flames for 5 points of non-melee damage.
[..] An orc thaumaturgist is burned by Marrowbane's flames for 5 points of non-melee damage.
```
```
^(?<target>.+?) is \w+ by (?<owner>YOUR|.+?'s|the) (?<effect>.+?) for (?<amount>\d+) points? of non-melee damage\.$
```
Owner forms seen: `YOUR` (→ you), `<Name>'s` (→ that player/pet), and **ownerless** forms like
`the frost` / `flickering flames` (environmental or unattributable — bucket as "Unknown" for now).
The `effect` word ("flames", "poison"…) is a *damage message*, not the literal spell name; mapping
to real spell names later needs a spell-message table (EQLogParser ships one).

### 4. Damage-over-time ticks
```
[..] Orc legionnaire has taken 9 damage from your Chords of Dissonance III.
[..] Orc centurion has taken 15 damage from Tainted Breath by Frogorson.
```
```
^(?<target>.+?) has taken (?<amount>\d+) damage from (?:your (?<spellA>.+?)|(?<spellB>.+?) by (?<caster>.+?))\.$
```
- `your <Spell>` → caster = you.
- `<Spell> by <Caster>` → named caster. This gives the **real spell name** directly — the best source for per-ability attribution.

### 5. Damage taken by you (not outgoing DPS — for future tank metrics)
```
[..] You were hit by non-melee for 93 damage.
[..] YOU were injured by falling.
```

## Modifier flags (crits) placement

`(Critical)` (and similar) can appear **after** the sentence terminator, not just after melee
damage — e.g. `… has taken 33 damage from Stinging Swarm by Orson. (Critical)` and
`Orson healed you for 318 hit points by Healing. (Critical)`. DoT, non-melee, and heal patterns
therefore allow an optional trailing ` (flag)` after the closing `.`/`!`.

Melee verbs are data-driven from the game's skill set (from `tries to <verb>`): includes `reave`
and `shoot` (archery) beyond the common ones; all normalized to base form for category merging.

## Healing

```
[..] Frogorson healed you for 7 hit points.
[..] Frogorson healed himself for 16 hit points.
[..] Bloodgurgler pet healed orc legionnaire for 0 (20) hit points by Courage.
```
```
^(?<healer>.+?) (?:heals|healed) (?<target>.+?) for (?<eff>\d+)(?: \((?<raw>\d+)\))? hit points(?: by (?<spell>.+?))?[.!]$
```
- **Effective vs. raw**: the plain form gives effective healing; the `N (M)` form gives
  effective `N` and raw `M` (so `0 (20)` is 20 healing that was all overheal). HPS uses effective.
- **Heal-over-time**: `healed <target> over time for N hit points by <Spell>` — the optional
  `over time` phrase is tolerated and treated as healing.
- **Reflexive** targets (`himself`/`herself`/`itself`/`themselves`) resolve to the healer;
  `you`/`YOU` to self.
- **Group heals are visible** — `Frogorson healed Feydie …` appears even when self isn't
  involved, so we get real group HPS. Heals also connect same-faction pairs for classification.
- Heals feed the **healing-done** metric; **damage taken** (tanking) needs no new parsing —
  every damage event already carries a target, so incoming damage is aggregated per target.

## Misses & avoidance (accuracy %, not damage)
```
[..] You try to crush orc legionnaire, but miss!
[..] Orc legionnaire tries to cleave Feydie, but misses!
```
Observed avoidance tokens: `but miss` / `but misses`. EQ also emits `parries`, `ripostes`,
`dodges`, `blocks`, `INVULNERABLE`, and "magical skin absorbs the blow" — include these when we
add accuracy so swing counts are correct.

## Fight boundary markers (deaths)
```
[..] You have slain Emperor Crush!
[..] Orc centurion has been slain by Feydie!
[..] Ambassador D`Vinn has been slain by Frogorson!
```
```
^You have slain (?<target>.+?)!$
^(?<target>.+?) has been slain by (?<killer>.+?)!$
^You have been slain by (?<killer>.+?)!$      ← your own death
```
Note names can contain backticks/apostrophes (`D`Vinn`) — don't assume `[A-Za-z ]` only.

## Non-combat noise to ignore

The log is dominated by chatter and spam that the parser must cheaply skip:
tells/says (`X tells General:2, '...'`), `Your wounds begin to heal.`, `Your feet move faster.`,
`Auto attack is on.`, looting, skill-ups (`You have become better at Mend! (56)`), casting
messages (`Feydie begins casting Languid Pace.`), etc. Fast-path: a line only matters if the body
contains `damage`, `slain`, `but miss`, or a few other keywords — filter before running full regexes.

## Entity classification (players/pets vs NPCs)

DPS needs to know which side an entity is on. Heuristics, in order:

1. **`You`/`YOUR`** → the self player (always).
2. Names appearing as DoT/spell **casters** (`... by Frogorson`) or as melee attackers with
   capitalized single-token proper names that also **take** healing/grouping lines → players.
3. Entities that get **slain** and are referred to with articles ("an orc thaumaturgist",
   "orc legionnaire") → NPCs.
4. **Pets**: names ending in "pet" ("An orc thaumaturgist pet") or the `<owner>'s pet` /
   ``\`s pet`` pattern; attribute pet damage to its owner when derivable, else track as its own row.

This is inherently fuzzy from a single client's log; EQLogParser keeps a running roster and
revises classification as evidence accumulates. We do the same: maintain an entity table,
default unknown melee targets of players to "NPC", and let death/heal/cast lines promote names to "player".

Both **players and NPCs are first-class rows** — the UI can inspect an NPC's outgoing damage (what
the mob did to the group) as well as each player's damage to the mob.

## Pets (self's pet)

Only *your* pet addresses you as **Master** in your own log, so a pet "say" line ending in
`Master` identifies it as the logging character's pet:

```
[..] Gore says, 'Attacking a decaying skeleton Master.'
```
```
^(?<pet>.+?) says,? '.*\bMaster\b[.!]?'$
```
The engine records `pet → owner` and **folds the pet's damage/healing/tanking into its owner**,
tagging the pet's categories with `🐾` in the owner's drill-down. Other players' pets can't be
attributed from a single client's log (their pets don't call *you* Master), so they remain their
own rows. `\bMaster\b` is case-sensitive, so NPC names like "Orc taskmaster" don't false-positive.

## Stances (self only)

Stance changes are logged **only for the logging character**:

```
[..] You assume an offensive stance.
[..] You assume a striker stance.
[..] You assume an evasive stance.
[..] You assume a balanced stance.
```
```
^You assume an? (?<stance>.+?) stance\.$
```
A character is in **two independent stances at once** — a melee stance and a caster *invocation* —
so we track two dimensions:

- **Melee stance** — `You assume a/an <stance> stance.` Observed: `offensive`, `defensive`,
  `evasive`, `striker`, `mage hunter`, `balanced` (more per class/level).
- **Invocation** (caster stance) — `You begin reciting the <name> invocation.` Observed:
  `spellblade`, `arcane mastery`, `recovery`, `inversion`, `divine`. (`You begin to change your
  invocation.` is just a transition and carries no name.)

```
^You assume an? (?<stance>.+?) stance\.$
^You begin reciting the (?<invocation>.+?) invocation\.$
```
- There is **no "return to normal" message** — each stays active until the next change on its
  dimension. Before the first line in a session, a dimension is `none`.
- Other players' stances/invocations are **not visible**, so this applies to `You` only.

The engine keeps a **timeline per dimension** and tags every self damage event with *both* the
melee stance and invocation active at its timestamp — powering "damage by melee stance" and
"damage by invocation" side by side, and a header that shows both current stances.
