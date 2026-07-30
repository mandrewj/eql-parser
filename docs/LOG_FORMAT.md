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

### 3b. Typed ability damage (a named attack that resolves as an element)
```
[..] You hit a bandit lookout for 4 points of fire damage by Burst of Flame.
[..] Ranshi`s warder hit a dark sacrificer for 8 points of disease damage by Sicken.
[..] Futor hit a Teir`Dal priestess for 52 points of fire damage by Fingers of Fire. (Critical)
```
```
^(?<attacker>.+?) hit (?<target>.+?) for (?<amount>\d+) points? of (?<type>magic|fire|cold|poison|disease|unresistable) damage by (?<spell>.+?)\.(?: \((?<flag>[^)]+)\))?$
```
- **The type adjective sits exactly where the melee patterns require `points of damage` with
  nothing in between**, so these lines matched nothing at all until the pattern above existed
  — 26,864 of them in a real log, 564,644 points of the self's own damage (~15% of the total).
- The verb is always the literal **`hit`** (past tense, for every attacker including `You`) and
  the spell is **always named**, across all 26,864. Anchoring on ` hit ` is what splits a
  multi-word attacker correctly (`Ranshi\`s warder hit …`).
- `(Critical)` is the only trailing flag observed.
- Like the DoT form, this **names the real ability**, so it needs no damage-message table.
  Recorded as `spell` damage: the type adjective says it is not a plain swing, and a single
  client's log gives no way to tell a melee-triggered ability from a cast one.

### 4. Damage-over-time ticks
```
[..] Orc legionnaire has taken 9 damage from your Chords of Dissonance III.
[..] Orc centurion has taken 15 damage from Tainted Breath by Frogorson.
[..] You have taken 50 damage from Burrowing Scarab by a death beetle.   ← a tick on ME
[..] A Tesch Mal Gnoll has taken 26 damage by Chords of Dissonance V.    ← "by", no caster
```
```
^(?<target>.+?) ha(?:s|ve) taken (?<amount>\d+) damage (?:from|by) (?:your (?<spellA>.+?)|(?<spellB>.+?)(?: by (?<caster>.+?))?)\.$
```
- `your <Spell>` → caster = you.
- `<Spell> by <Caster>` → named caster. This gives the **real spell name** directly — the best source for per-ability attribution.
- **`ha(?:s|ve)`** — a tick on *you* reads `You **have** taken`, which the third-person form
  cannot match. The same trap as `You have been slain by`, and it cost 1,331 lines and
  **32,949 points of damage taken** — absent from the tank column, the stance cards'
  defensive cost, and the whole lower half of the history chart.
- **`from|by`** — 395 lines say `damage **by** <Spell>` and name no caster at all, among them
  the self's own Chords of Dissonance and Denon's Disruptive Discord. Caster resolves to
  `Unknown`, which is what the line actually says.

### 5. Damage to you from a source the log doesn't name
```
[..] You were hit by non-melee for 93 damage.
[..] YOU were injured by falling.
```
```
^You were hit by non-melee for (?<amount>\d+) damage\.$
```
Distinct from form 3 — no `points of`, no owner. Recorded against an `Unknown` attacker, which
only ever appears on the dealing side of a blow and so never becomes a mob of its own.
`injured by falling` is environmental and still ignored.

### 6. A fully absorbed damage shield (no damage — avoidance)
```
[..] A yun ghoul wizard's magical skin absorbs the damage of YOUR thorns.
[..] Princess Cherista's magical skin absorbs the damage of Orson's thorns.
```
```
^(?<target>.+?)'s magical skin absorbs the damage of (?<owner>YOUR|.+?'s) (?<effect>.+?)\.$
```
Zero damage, so it counts as **avoidance**, not a damage event. Its sibling
`<Target>'s magical skin absorbs the blow!` needs no pattern of its own — it arrives inside a
`tries to …, but …!` line the miss patterns already read.

## Modifier flags (crits) placement

`(Critical)` (and similar) can appear **after** the sentence terminator, not just after melee
damage — e.g. `… has taken 33 damage from Stinging Swarm by Orson. (Critical)` and
`Orson healed you for 318 hit points by Healing. (Critical)`. DoT, non-melee, and heal patterns
therefore allow an optional trailing ` (flag)` after the closing `.`/`!`.

Every flag seen in a real log, and what it means for parsing:

| flag | count | handling |
|---|---|---|
| `(Critical)` | 6,737 | sets `crit` on melee, typed ability, DoT and heal |
| `(Riposte)` | 4,422 | a counter-attack; real damage, already melee, **not** a crit |
| `(Slay Undead)` | 204 | an ability proc; real melee damage |
| `(Flurry)` | 137 | an extra swing; real melee damage |
| `(Riposte Critical)` | 35 | **is** a crit — the test is `/critical/i`, not equality |
| `(Finishing Blow)` | 49 | real melee damage |

**Tolerating a flag is not the same as reading it.** Every pattern allowed the trailing group
from the start, but only melee ever captured it, so 289 DoT crits and 202 heal crits were
counted as ordinary hits. Crit *counts* were understated; totals were always right.

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
Observed avoidance tokens, by frequency: `misses`/`miss` (154k), `dodges` (5.9k), `blocks`
(4.4k), `parries` (2.4k), `ripostes` (1.3k), and `<X>'s magical skin absorbs the blow` (304).
All are captured by the trailing `but (.+?)!` group; only the count is used today.

**The verb is a phrase, not a word.** `frenzy on` is the one multi-word entry
(`Chompy tries to frenzy on orc taskmaster, but misses!`), so the verb group is
`(\w+(?: on)?)`. With a bare `\w+` the particle falls into the target instead, inventing an
entity called `on orc taskmaster` — harmless in the damage tables, which it never reaches, but
it does reach the friend/foe classifier, where a phantom NPC can flip the mob that swung at it
to *friendly*. The damage form (`frenzies on`) was never affected: its verbs are a fixed list.

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

Your own death needs its own pattern: it reads **"You *have* been slain"**, so the
third-person `has been slain by` form never matches it.

## Character progression (self only)

Rare, dated events that explain a step change in the numbers — a ding, a new ability, a
death, a zone. Every one of these is about **you**; other characters' progression isn't
in your log.

```
[..] You have gained a level! Welcome to level 34!
[..] You have gained 2 ability point(s)!  You now have 4 ability point(s).
[..] You have gained the ability "Banestrike" at a cost of 0 ability points.
[..] You have improved Mnemonic Retention 2 at a cost of 1 ability point.
[..] You have gained the ability to use Double Attack.
[..] You have become better at Flying Kick! (112)
[..] You gain party experience! (8.995%)
[..] You gain experience! (2.761%)
```
```
^You have gained a level! Welcome to level (?<level>\d+)!$
^You have gained (?<gained>\d+) ability point\(s\)!\s+You now have (?<total>\d+) ability point\(s\)\.$
^You have gained the ability "(?<aa>.+?)" at a cost of (?<cost>\d+) ability points?\.$
^You have improved (?<aa>.+?) at a cost of (?<cost>\d+) ability points?\.$
^You have gained the ability to use (?<skill>.+?)\.$
^You have become better at (?<skill>.+?)! \((?<level>\d+)\)$
^You gain (?:party )?experience! \((?<pct>[\d.]+)%\)$
```
- The ability-point line carries a **double space** between its two sentences — match `\s+`.
- `gained the ability "X"` (quoted, with a cost) is an **AA purchase**; `gained the ability
  to use X` (unquoted, no cost) is a **skill unlock**. Same opening words, different events.
- `improved <X> <rank>` puts the rank on the end of the name, and the name may carry its own
  punctuation (`Symphonic Aura: Enabled 10`) — split at the **trailing** number only.
- Cost can be `0` (granted by the level, not bought), and the singular/plural of
  "ability point" varies with the number.
- Percentages are **percent of the current level**, so summing them gives "how much of a
  level did this stretch earn".
- These are far rarer than damage lines, so the parser only tries them after every damage
  pattern has missed, behind one `^You (have )?(gain|become|improved)` prefix test.
- `You have reached the experience cap and will not gain any further experience.` is not an
  xp tick and must not match.

## Coverage, and how it is checked

Hand-written "is this line relevant?" regexes are how the gaps above survived — `parse:check`
shared the parser's own blind spots and reported the log clean throughout. The check that
actually works is the opposite shape: run **every** line through `parseLine`, cluster what comes
back `null` by shape (numbers and proper nouns collapsed to tokens), and read the ranked tail.
That is what surfaced typed ability damage, the `have taken` ticks and the `damage by` form.

Against the 785k-line log, exactly **three** unparsed lines still carry both a number and a
combat word, and none is worth a pattern:

```
You have been healed for 80 hit points.        ← 1 occurrence, names no healer
You gain a rune for 305 points of absorption.  ← 1 occurrence, absorption applied, not damage
You tell your party, '… my DPS 50PCT …'        ← chat
```

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
5. **Charmed mobs** are friendly *for as long as the charm holds* — an entity whose side
   changes mid-fight, which is why it is a window rather than a fact (see "Charmed pets").

This is inherently fuzzy from a single client's log; EQLogParser keeps a running roster and
revises classification as evidence accumulates. We do the same: maintain an entity table,
default unknown melee targets of players to "NPC", and let death/heal/cast lines promote names to "player".

Both **players and NPCs are first-class rows** — the UI can inspect an NPC's outgoing damage (what
the mob did to the group) as well as each player's damage to the mob.

## Pets (self's pet)

Only *your* pet addresses you as **Master** in your own log, so a pet line ending in
`Master` identifies it as the logging character's pet. This game delivers that chatter as
**`told you`** — `says` did not appear once in a 768k-line log, and matching only `says`
left every summoned pet undetected:

```
[..] Jonantik told you, 'Attacking a bandit lookout Master.'
[..] Kebekn told you, 'I am unable to wake an imp protector, Master.'
[..] Gore says, 'Attacking a decaying skeleton Master.'        ← classic phrasing, kept
```
```
^(?<pet>.+?) (?:says|told you),? '.*\bMaster\b[.!]?'$
```
- The terminator allows the **comma** form, where `Master` is an address rather than the
  sentence's tail (`…, Master.'`).
- Pet names are re-rolled on every summon, so one player produces many over a session (22
  in this log). They can be told from *charmed* pets, which also use this line, because
  charmed names never interleave with a summon's: two names alternating in one stretch
  were always the two mobs being charm-swapped, never two summons.
The engine records `pet → owner` and **folds the pet's damage/healing/tanking into its owner**,
tagging the pet's categories with `🐾` in the owner's drill-down. Other players' pets can't be
attributed from a single client's log (their pets don't call *you* Master), so they remain their
own rows. `\bMaster\b` is case-sensitive, so NPC names like "Orc taskmaster" don't false-positive.

## Charmed pets (a mob fighting on our side)

A charmed mob keeps its own name and fights for its charmer. Nothing in the log ties the
two together directly — **the landing message names the mob but no caster, and the cast
names the caster but no target** — so the parser emits both halves and the engine pairs
them by time.

**Landing** — two forms, both seen in a real 742k-line log:

```
[..] a lava beetle's eyes glaze over.
[..] a greater dark bone has been charmed.
```
```
^(?<mob>.+?)'s eyes glaze over\.$
^(?<mob>.+?) has been charmed\.$
```
- `eyes glaze over` is **charm, not mesmerize**, in this game: 12 casts of the bard mez
  song (`Solon's Song of the Sirens`) produced zero glaze lines, while every glazed mob
  went on to attack other mobs. Names ending in `s` still split at the possessive
  (`a greater ice bones's eyes glaze over.`).
- A bard's charm is a *song*, so it re-lands on every pulse — the same mob glazes over and
  over. That is one pet, not a new one each tick.

**The landing message identifies the spell, and therefore the caster's *class*.** Each spell
page on the [EQL wiki](https://eqlwiki.com/Category:Spells) carries a `Cast on Other Message`
field, with `Someone` standing in for the mob's name:

| message | spells | class |
|---|---|---|
| `<mob> has been charmed.` | Charm, Beguile, Cajoling Whispers | Enchanter |
| `<mob>'s eyes glaze over.` | Solon's Bewitching Bravura | Bard |
| `<mob> blinks.` | Charm Animals, Beguile Animals | Druid / Shaman |
| `<mob> moans.` | Dominate Undead, Beguile Undead | Necromancer |

Only the first two are implemented: `blinks` and `moans` occur **zero** times in an 875k-line
log, and both are generic enough to fire on ordinary ambient emotes, so recognising them would
risk inventing pets for no observed gain. The table lives in [`spells.ts`](../src/parser/spells.ts).

**Ownership** — from a charm cast shortly before the landing:

```
[..] Phatez begins casting Charm III.
[..] You begin singing Solon's Bewitching Bravura V.
```
```
^(?<caster>.+?) begins? (?:casting|singing) (?<spell>.+?)\.$
```
Only **charm-named spells** count. Verified in the log: `Charm`/`Charm III` and
`Beguile I`–`IV` (enchanter), `Solon's Bewitching Bravura` (bard). The engine pairs a
landing with the most recent such cast within **3 seconds** — measured against real data,
128 of 153 landings fall in that window and only one more arrives by 6s, so widening it
buys nothing and risks crediting the wrong enchanter in a busy camp. An unpaired landing
is still a charm; it just gets no owner.

**Breaks** — only your own charm announces itself:

```
[..] Your Solon's Bewitching Bravura spell has worn off of an imp protector.
[..] You miss a note, bringing your Solon's Bewitching Bravura to a close!
```
```
^Your (?<spell>.+?) spell has worn off of (?<mob>.+?)\.$      ← charm spells only
^You miss a note, bringing your (?<song>.+?) to a close!$     ← names no mob
```
The second names the song and no mob, so it breaks **every** charm that song was holding.
Another player's charm ending is announced to nobody, so those are detected behaviourally
— see [`ARCHITECTURE.md`](ARCHITECTURE.md).

**A charmed pet also names its charmer**, using the same `Master` line as a summoned pet —
and it names its target too:

```
[..] A fire giant warrior told you, 'Attacking a fire giant warrior Master.'
```
This is the *strongest* ownership evidence there is, better than time-matching a cast: it
says outright whose pet it is. (It is also proof of the twin case below — the pet is being
sent at a mob of its own name.)

**The hard limit: names are not identities.** Entities are keyed by name, and two mobs can
share one:

```
[..] A wan ghoul knight tries to slash a wan ghoul knight, but misses!
[..] A fire giant warrior slashes a fire giant warrior for 79 points of damage.
```
A single client's log cannot tell them apart, with two consequences:
- A charmed mob is **never trusted to classify anyone else**, in either direction — its
  swings would otherwise brand whoever its *twin* mauls (a groupmate) as a mob.
- Same-name blows do prove there are **two** mobs, since **nothing attacks itself**, so the
  attacker is split onto a key of its own from that point. That proof stands alone and needs
  no charm message to back it up — which matters, because by the time such a blow appears the
  charm has usually been *lost* rather than never seen: our swings at the enemy twin land on
  the shared key and read as swings at our own pet, breaking the charm before the pair is ever
  revealed. Where no charmer is known, none is invented; the row simply carries no owner.
- Which side of any individual blow was the pet stays unknowable — both swing and the lines
  are identical — so the exchange is credited to the pet as an **upper bound** and the UI
  marks it.

## `/who` results — the only place a class is stated

```
[42 PAL/MNK/BRD] Sanluen (Wood Elf) <Afterlife> ZONE: Nagafen's Lair (soldungb)
[32 PAL/MNK/ENC] Mirad (Iksar)  ZONE: Nagafen's Lair (soldungb)
[1 RNG/SHM] Dunalin (Barbarian)  ZONE: EverQuest Legends Tutorial (tutorial)
```
```
^\[(?<level>\d+) (?<classes>[A-Z]{3}(?:\/[A-Z]{3})*)\] (?<name>\S+) \(
```
- Characters hold **up to three classes**; the guild tag is optional and the zone always present.
- `ZONE: ` gates these in the keyword prefilter and is near-exact — **468 of the 469** lines
  carrying that token in an 875k-line log are `/who` results.
- This is the **only** line that ever states anyone's class, which is what makes the charm
  emote table above actionable: `has been charmed` means an Enchanter cast it, and a fight with
  exactly one Enchanter in it therefore has exactly one candidate charmer. Two, and the pet is
  left unowned rather than attributed on a coin flip.
- A `/who` never opens, extends or closes a fight — it is not combat.

## Damage shields, and why no message table is needed

An 875k-line log contains exactly **three** damage-shield messages, which is the whole of the
"map a damage message to a real spell" problem the non-melee form poses:

| message | hits | spell | element |
|---|---|---|---|
| `thorns` | 27,931 | thorns-line damage shield | magic |
| `flames` | 2,921 | Shield of Flame (Magician 19) | fire |
| `frost` | 159 | cold-line damage shield | cold |

Every *other* damage line already states its element inline (`for 151 points of **magic**
damage by Smiting Strike`), so classification needs no lookup table — a point worth recording,
because the obvious next step is to scrape all 1,965 spell pages and it would buy nothing.

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
