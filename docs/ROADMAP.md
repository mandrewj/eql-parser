# Roadmap

Milestones are ordered so each is runnable and verifiable on its own. Earlier milestones need no UI,
so we prove the parser/engine are correct against the real log before building anything visual.

**Runtime:** TypeScript on **Node.js 22** (already installed). Dev via `tsx`, tests via `node --test`,
live updates via **SSE**. Single-binary packaging deferred to M5 (Node SEA).

**Progress:** M0–M5 complete — v1 shipped. Parser, engine, live tailer/SSE, React UI, and a
single self-contained bundle (`dist/eql-parser.cjs`) plus an optional native SEA binary. Everything
after that is the **Post-v1** sections below, newest last: the app has since been rebuilt around
per-NPC encounters and a self-analysis panel, which is where the work now goes.

## M0 — Project scaffold  ✅
- TypeScript project (Node + tsx), tsconfig, `.gitignore`, folder layout (`tailer/ parser/ engine/ server/ web/`).
- Core domain types (`CombatEvent` incl. `Stance`, `Entity` w/ NPC support, `Fight`, `CombatantStats`).
- Config loader with OS-aware detection + **listing of all `eqlog_*.txt`** (name → character/server, size, mtime).
- Minimal server: `GET /api/logs`, `POST /api/logs/active`, SSE `/events`, and a placeholder web page with a **log picker**.
- **Done when:** `npm run dev` starts, prints the resolved log dir + detected logs, serves the picker at `http://localhost:<port>`.

## M1 — Parser + fixtures (no I/O, no UI)  ✅
- `parseLine` for every event type in [`LOG_FORMAT.md`](LOG_FORMAT.md), **including stance lines**.
- Fixture set of real lines (melee, spell, DoT, crit, miss, death, stance, plus noise to ignore).
- Unit tests: each fixture → expected `CombatEvent`; noise → `null`.
- **Done when:** parsing the full log throws nothing and classifies every damage/slain/miss/stance line.

## M2 — Engine: fights, entities, stances, DPS (batch mode)  ✅
- Entity roster (players + pets + **NPCs**), fight segmentation, per-combatant aggregation.
- **Stance timeline** + damage-by-stance for self; **damage-by-type** and **per-ability** breakdowns.
- CLI that replays a whole log and prints, per fight: the DPS table, an NPC's outgoing damage, and the self stance split.
- Validate against a hand-checked fight (candidate: the `Emperor Crush` kill).
- **Done when:** CLI report matches manual spot-checks, and stance splits line up with the `assume` timestamps.

## M3 — Live tailer + server  ✅
- Byte-offset tailer (CRLF/partial-line, watch + poll, rotation reset), **runtime-switchable active log**.
- JSON API (`/api/logs`, `/api/logs/active`, `/api/fights`, `/api/fights/:id`, `/api/config`) + SSE streaming of engine state.
- **Done when:** with the game running, switching logs works and the SSE stream reflects combat within ~1s.

## M4 — Web UI (v1 feature-complete)  ✅
- **Log picker** to select the actively parsed log.
- **Live pane**: current fight, sorted bars, self highlighted, live DPS, live stance indicator, and **filters** (combatant kind: players/NPCs/pets · damage type: melee/spell/DoT · stance).
- **History pane**: fight list → **drill-down** (per-combatant → damage-type split → per-ability; self stance split for the fight).
- Auto-reconnect, empty/idle states.
- **Done when:** you can play a session, switch logs, filter live, and inspect any past fight end-to-end in the browser.

## M5 — Packaging & polish  ✅
- **Node SEA** single executable with the SPA embedded; verify Windows path detection (and evaluate Bun `--compile` for a Windows build).
- First-run: auto-open browser; friendly message if no log found.
- Settings UI (log dir, port, inactivity timeout).
- **Done when:** a fresh machine runs it by double-clicking one file, nothing else installed.

## Post-v1 — Per-NPC encounters & character-card UI  ✅
- Engine tracks per-target damage → `encounters`: one DPS meter per NPC (pets folded to owners,
  alive/dead flag). Simultaneous mobs each get a live pane.
- UI redesigned around **character cards** showing damage/healing/tanking at once, with a
  "Rank by" selector; per-NPC **encounter panes** for live fights.
- Parser hardened on a 158k-line log: crit flags after the terminator, heal-over-time, and the
  `reave`/`shoot` verbs — 0 unparsed combat lines.

## Post-v1 — Healing & tanking  ✅
- `HealEvent` parsing (effective/overheal, reflexive targets, `by <Spell>`); group heals visible.
- Engine gives each combatant three metric groups — damage done, healing done, damage taken —
  each with total + per-category breakdown; heals also inform friend/foe classification.
- Melee verbs normalized to base form so `kick`/`kicks` merge into one category.
- UI: Damage/Healing/Tanking selector; drill-down is a table (total + top ~10 categories).

## Post-v1 — Readability pass on the encounter tables  ✅
- Your own row stays expanded in every encounter, so the damage breakdown line is always on screen
  without a click; other combatants still toggle.
- k-notation thresholds tuned per column (10k dps/hps, 2k tank, 1k in drill-downs) via one shared
  `scaleK` helper — big tanking and breakdown numbers stop overflowing the narrow columns.
- Bolder theme: darker page behind raised panels, heavier type on names/numbers, and a loud
  active-encounter treatment (accent stripe, warm frame, pulsing live dot) versus neutral finished ones.

## Post-v1 — Encounter history chart in the My DPS panel  ✅
- Engine ships `encounterHistory`: the last 50 finished encounters from my side (dps, damage,
  damage taken, duration) tagged with the stance combo I spent the most time in during each.
- The stance-combo cards stay; below them a diverging bar chart plots those encounters —
  DPS above the baseline, damage taken below, each half scaled to its own labelled peak.
- Bars are coloured by stance combo, matching a swatch on each card; hover names the encounter,
  clicking a card highlights only that combo. Colour follows the combo (first-seen order), so
  switching the 10/25/50 window never repaints a bar.

## Post-v1 — Stance cards answer "what does it cost me?"  ✅
- Engine mirrors the self combo log for **incoming** damage, so each stance combo reports
  damage taken per second next to its DPS — the defensive half of the stance choice.
- Cards also show **time share** (percent of the window's combat seconds spent in the combo),
  which exposes a high-DPS tile built on a thin sample.
- Panel header compares the combo you're in right now against the window's best.

## Post-v1 — Cache headers & a cleanup pass  ✅
- Static responses carried no `Cache-Control`, so a browser-cached `index.html` outlived the bundle
  hash it named after a rebuild — a 404 that looks like a blank page. `assets/*` is now immutable,
  everything else `no-store`.
- Tidy-up over the new code: `comboSecondsIn` no longer copies the segment array per call, the
  dominant-combo scan is its own helper, the two identical combo-log scans merged, and the chart's
  two diverging halves share one builder instead of being duplicated.

## Post-v1 — Progression on the encounter timeline  ✅
- Parser learns **character progression**: level-ups, ability points, AAs bought and ranked up,
  skill unlocks, skill-ups and xp ticks. Tried last, behind one prefix test, so the damage path
  is unaffected.
- Two bugs surfaced doing it, both now fixed: **my own death never parsed** (the log says "You
  *have* been slain", which the third-person pattern can't match), and a **friendly death wiped
  that character's damage** from every mob still being fought.
- Engine ships `milestones` (the rare, markable kinds), `progressWindows` (per-window totals over
  the same 10/25/50 slices) and `progress` (level + unspent AA). Progression never opens or closes
  a fight.
- The history chart gains a **milestone rail** on its baseline — ▲ level, ◆ ability point,
  ★ ability, ✕ death, » zone — placed on the encounter boundary each event landed on, with
  full-height guides for levels and deaths. Identity is shape, not colour; hover names the event.
- Chart polish: gradient bars with rounded caps, an outline on the encounter that set each peak,
  a dashed average line matching the header's figure, and a header that reports the window's span.
- A **progression strip** under the chart reports current level / unspent AA and what the window
  earned, reusing the rail's glyphs as its own legend.

## Post-v1 — Density pass for the real side-panel width  ✅
- Measured against how it's actually used: a ~540px panel beside the game window. Root font to
  **13px**, tighter topbar/tabs/section headings; the chart's px heights left alone.
- Reclaimed the two clear wastes — grids switched to **`auto-fit`** (`auto-fill` was stranding half
  the tile row), and a stance tile now **row-wraps** so one combo is a line, not a near-empty box.
- Column labels print **once per section**; the self drill-down shows the top **4** abilities.
- Milestone clusters collapse to **one mark per kind with a count** (`»⁴`) instead of three glyphs
  and a `+N`.
- Order left alone deliberately: the My DPS panel stays pinned above the active fight.

## Post-v1 — Encounter headers say whose numbers they are  ✅
- The header's totals always covered the **whole encounter**, but nothing said so, and the rows
  underneath are deliberately per-person — so the two were easy to conflate. The right-hand group is
  now labelled `encounter` and names its units (`encounter 24s · 4,087 dmg · 170 dps`), with a `title`
  spelling out that the rows below are per-person.
- The combined DPS moved from the UI (which divided two already-rounded numbers) into the engine as
  `EncounterView.dps`, over the unrounded span.
- New `EncounterView.npcDamage`: what the mob dealt back, summed over every friendly it hit, over the
  same span — printed in red next to its name (`an imp protector → 29 dps`), hidden for a mob that
  never landed a hit. Built by scanning `perTarget` for the mob's own attacker cells, which
  `resetNpcTracking` already clears on death, so a same-named respawn starts from zero.
- Header is now three parts on one line: name (shrinks, ellipsis), what it hits for, totals pinned
  right. Verified against a real snapshot in the SSR harness, including a long-boss-name stress case.

## Post-v1 — Average-DPS audit: what each rate divides by  ✅
- **Chart bars are normalized by encounter length.** They used my *personal* active window inside each
  encounter, so joining a fight for its last 6 seconds plotted as my best encounter ever — and, being
  the peak, rescaled every other bar. On the real log the peak fell 154 → 119 dps and now belongs to a
  28-second fight. The encounter *table* still shows per-person rates; that's the right answer to a
  different question ("how fast was each of us going while engaged"), and both are documented.
- **The average line is now the duration-weighted mean of the bars it crosses** (Σ damage ÷ Σ encounter
  seconds), computed inside the chart from the array being drawn rather than passed in from a different
  calculation. Never a mean of per-encounter rates.
- **Damage taken is a rate too** (`takenPerSec`), so both halves of the diverging chart are the same
  kind of number instead of a rate over a total.
- **Fixed an inflated headline rate**: the panel header re-summed the tile rows, which the engine had
  already filtered to combos with damage > 0 — so seconds spent in a combo without swinging vanished
  from the denominator. `StanceOverviewWindow` now ships the window's own pre-filter `damage`/`seconds`.
- The header (merged wall-clock seconds) and the chart line (summed encounter seconds) legitimately
  differ when mobs overlap — 75 vs 70 on a real window. Both are time-weighted; each tooltip names its
  denominator, and ARCHITECTURE explains which to quote.

## Post-v1 — Engaged time per person in the encounter panes  ✅
- Every encounter row gains a `time` column: the seconds that character was engaged with the mob
  (`EncounterCard.activeSec` — their first contact, whether they swung or were hit, → the encounter's
  end). The engine already computed this window to divide their rates by; it just never shipped it.
- That makes the whole table self-explaining: the row's dps × its time is its damage, so a short window
  behind a big headline rate is visible instead of having to be inferred (Mirad: 5s of a 31s fight).
- The accent for a partial window fires only below **70%** of the encounter. Flagging any shortfall at
  all lit up nearly every row — almost nobody engages on the exact second the mob is first seen.

## Post-v1 — Cleanup pass over the three encounter changes  ✅
- Dropped the "tolerate an older backend" fallback in `EncounterTable`: the mirrored types declare
  `dps`/`npcDamage` required, so the guards were unreachable — and the fallback was a *second* copy of
  the header rate that divided by rounded seconds, disagreeing with the engine on any fractional span.
  Defensive normalization belongs at the `useAppData` ingest boundary, which is where the existing
  `?? []` defaults live.
- `npcDamage` now folds the **total only** (`rateStat`), not a full ability breakdown — measured at
  1.4KB of every 59.3KB snapshot, duplicating what each victim's `taken` already carries.
- Single-pass window totals in `overviewForWindow` (was two spreads + two reduces over one map), the
  unreachable `Math.max(1, durationSec)` clamp dropped, `win?.x ?? 0` destructured once, and the chart's
  per-point `title` moved into the `marks` array it already builds — it was being composed twice per
  render, once for each half of the diverging chart.
- `PARTIAL_WINDOW` and `--partial` replace an inline `0.7` and a hardcoded hex.
- Documented what was imprecise: the header and chart averages differ in **numerator** as well as
  denominator (62,416 vs 60,969 on a real window), and README still said WebSocket in two places.

## Post-v1 — Test the UI's arithmetic, and make the stance rebuild cheap  ✅
- **Web helpers are now covered by the existing runner.** The pure parts moved out of the components
  into `web/src/format.ts` (the `scaleK` family, whose thresholds exist for the 540px panel) and
  `web/src/stats.ts` (`weightedAvgDps`, `isPartialWindow`), so `node --test` covers them with no second
  runner and no new dependency. Node's types live only in `web/tsconfig.test.json`, so a component still
  can't reach for `process` and typecheck — that config must clear the inherited `exclude`, or the test
  files are filtered back out and the check passes on nothing.
- **`stanceOverview`: 758µs → 146µs** on the real 628k-line log, taking a cold `snapshot()` from 854µs to
  174µs. It was `merged.some(...)` per combo-log entry; the logs are chronological and the windows sorted
  and disjoint, so one pointer walks them together, and a bisect skips to the first entry in range.
  Proved byte-identical to the naive scan over the whole log before landing.
- **A bug the new boundary test found:** a mob you one-shot is first seen and slain in the same log
  second, so its window interval is zero-width — it contributed damage to the window with *no seconds*,
  inflating every rate divided by them. Intervals are now clamped to a second, matching the clamp
  `durationSec` already applied. No effect on the current log, where every mob trades blows first.

## Post-v1 — A DPS sparkline on every encounter card  ✅
- The averages now say *how much*; the sparkline says **when**. Each encounter card carries my damage
  across the fight, bucketed at the log's own one-second resolution (widening past 40 buckets), scaled
  to its own peak.
- Needed new engine state: `selfHits`, my damage to each target with timestamps. `selfComboLog` is
  per-session rather than per-mob, so during a two-mob pull it would have drawn a strip that disagreed
  with the row directly above it. Cleared in `resetNpcTracking`, so a same-named respawn starts empty.
- Leading empty buckets are deliberate: they are the seconds the mob was up before I engaged, which is
  the `time` column drawn as a picture.
- Bucket slots are a fixed 11px, so the strip's length tracks the fight's duration. Full-width bars
  turned a 7-bucket fight into blocks; capped bars in stretched slots read as scatter — both were
  screenshotted against real encounters before settling here.

## Post-v1 — Charmed pets in the encounter tables  ✅
- A charmed mob fights for us, and none of its damage was reaching the DPS list. Worse, it took
  the pre-charm damage with it: on one real fight the mob I charmed dealt **924 damage** to the
  target that went unrecorded, while the mob itself sat in the list as a phantom encounter
  holding the 119 damage I'd done before charming it. Across the log the fix surfaces
  **91,180 damage over 174 rows** — 57,463 of it from my own charm pets.
- Parser gains a `Charm` event with three states, because the log splits the fact across lines
  that never share a subject: the landing names the mob and no caster, the cast names the caster
  and no mob. Pairing them is the engine's job, so `parseLine` stays pure. `eyes glaze over` is
  charm here, not mez — verified against 12 mez casts that produce no such line.
- **The mob gets its own row, never folded into its charmer** — a charm is temporary, breakable,
  and often someone else's. Owner shown as a tag when a charm cast within 3s identifies one
  (160 of 174 rows); unowned otherwise rather than guessed.
- Boundaries are real events: the mob's life **before** the charm is banked as a finished
  encounter and its tracking wiped, and again when the charm breaks — the same one-name-two-lives
  reset a respawn already used.
- Break detection is mostly behavioural, since only your own charm is announced. Two false
  positives found on real data and fixed: **a pre-charm DoT still ticking** un-charmed a healthy
  pet a few seconds in, and a **swing already in the air** when the charm landed did the same
  (glazed at 03:35:56, struck a groupmate at 03:35:57, then fought for us for 30s).
- **Two classification bugs surfaced and fixed**, both putting *players* in the encounter list:
  rules all guard on "not already classified", so log order decided the winner — now tiered, with
  strong evidence first. And a charmed mob is no longer trusted to classify anyone, in either
  direction, because entities are keyed by name and names are not unique (`A wan ghoul knight
  tries to slash a wan ghoul knight` — the charmed one fighting its twin). That also removed two
  phantom player encounters (`Prisms`, `Rykkerr`) the pre-charm code was already inventing.
- Validated by replaying the whole 742k-line log before and after: no player name gained an
  encounter, two lost theirs, and my own damage total moved 0.8%.

## Post-v1 — Pet chatter, and charmed mobs that share their target's name  ✅
- **Summoned pets were never detected at all.** `PET_SAY_RE` matched `X says, '… Master.'`,
  but this game delivers pet chatter as `X told you, '… Master.'` — `says` appears zero
  times in 768k lines, so `parse:check` reported `pet: 0` and no pet ever folded into its
  owner. Now 318 pet events.
- **A charmed mob fighting its own namesake is now a participant.** Entities are keyed by
  name, so the charmed one and the mob it was sent at were a single entity: the encounter
  showed neither its damage nor, for a while, itself. A blow between them proves there are
  two (nothing attacks itself), so the charmed one splits onto its own key from that point.
  On the live fire giant fight this surfaced a **4,613-damage exchange** the list showed
  nothing of, and stopped the charm breaking seconds in — our swings at the *twin* had been
  reading as swings at our own pet.
- Which of the pair swung on any given line is unknowable, so the exchange is credited to
  the pet as an **upper bound** and the row carries a `~` tag saying so. Better than the
  alternatives: crediting nothing hid a 38%-of-encounter participant, and splitting it
  evenly would have invented a number.
- A pet's `Master` line turns out to be the **best ownership evidence available** — it names
  the charmer outright, where the cast window only time-matches. It sets the charm's owner
  rather than a `petOwners` entry, since filing a charm as a summon would fold it into that
  row (and, in the twin case, fold the enemy in with it).
- Recovered **143k of my own damage** on charm-target mobs that the shared key had been
  wiping on every charm/break cycle. Spot-checked against raw grep on one fight: engine
  5,332 vs 3,858 melee + 1,186 DoT + 288 proc = exact.

## Post-v1 — Typed ability damage, which was never parsed at all  ✅
- `You hit a fire giant warrior for 151 points of **magic** damage by Smiting Strike.` The damage
  patterns require `points of damage` with nothing in between, so every line carrying a type
  adjective matched nothing: **26,864 lines, 564,644 points of my own damage — ~15% of my total**,
  absent from every figure the app has ever shown. Found while ground-truthing the charm work.
- **`parse:check` reported the log clean the whole time**, because its own relevance regex had the
  same blind spot. Fixed in the same pass, which is what makes the "0 unparsed" line mean something.
- The form names the real ability, like DoT ticks do, so the per-ability breakdown gets `Smiting
  Strike` rather than a damage message. Recorded as `spell`: the adjective says it is not a plain
  swing, and one client's log can't separate a melee-triggered ability from a cast one.
- Also picks up the `(Critical)` flag these lines carry, which `SpellDamageEvent` had no field for —
  spell crits had been silently counted as zero.
- Log-wide: `spell` events 39,723 → 67,217, total damage 9.3M → 11.7M, my own 3.53M → 4.15M.
  Spot-checked against raw grep on one fight: engine 5,936 vs 3,858 melee + 1,186 DoT + 288 proc
  + 604 typed = exact.

## Post-v1 — A full parser audit, by clustering every unparsed line  ✅
- The typed-damage miss proved that a hand-written "is this relevant?" regex only ever finds what
  it already knows about — `parse:check` shared the parser's blind spots and called the log clean.
  Replaced with the opposite shape: run **every** line through `parseLine`, cluster the `null`s by
  shape (numbers and proper nouns collapsed), read the ranked tail. 7,039 distinct unparsed shapes,
  205 combat-suspicious. Four real finds:
  - **`You have taken N damage from <Spell> by <X>`** — 1,331 lines, **32,949 damage taken**. DoT
    ticks on *me*: `DOT_RE` matched only `has taken`. The third time this exact has/have trap has
    bitten (see the death-line fix above).
  - **`<X> has taken N damage by <Spell>`** — 395 lines, 7,411 damage. A preposition: `by`, not
    `from`, naming no caster. Includes ~800 of my own Chords/Denon's ticks.
  - **`You were hit by non-melee for N damage`** — 62 lines, 2,465 damage taken, attacker unnamed.
  - **`X's magical skin absorbs the damage of YOUR thorns`** — 292 lines of fully-absorbed damage
    shield. Zero damage, so it lands in `avoided`, not as a damage event.
- Log-wide: dot events 44,392 → 46,813, my damage taken **1.45M → 1.51M**, my damage 4.15M → 4.22M.
- Combat-suspicious unparsed shapes fell 205 → 85, and every survivor is flavour text with no
  number in it. Exactly **three** unparsed lines in 785k now carry both a number and a combat word,
  all one-offs and none worth a pattern — they are listed in `LOG_FORMAT.md` so the next audit
  doesn't re-derive them.

## Post-v1 — A mob never attacks itself, so stop requiring a charm to prove it  ✅
- The same-name split still depended on the charm flag being *set* when the blow arrived, and in
  a live fight it almost never is: our swings at the enemy twin land on the shared key and read
  as swings at our own pet, so the charm breaks first. A fire giant warrior charmed by a
  groupmate fought its namesake for a full minute and contributed **nothing** to the table.
- Now the blow alone is the proof — nothing attacks itself — and a charm is inferred when none
  is known. Log-wide this takes charmed-pet rows 265 → **361** and the damage they surface
  223,526 → **382,109**.
- Where the log names no charmer, none is invented. For another player's charm it usually names
  none at all: on the live fight there was no charm cast within 20 seconds of the landing, so
  the charmer is genuinely absent from the file rather than merely unmatched.

## Post-v1 — A semantic audit: not "did it parse" but "did it parse *right*"  ✅
- The coverage audit asked whether a line produced an event. This one asked whether the event was
  correct: every quantified combat line grouped by shape (3,049 of them), with what the parser made
  of each. Three findings, and one clean bill of health.
- **`frenzy on` mangled its target.** The miss patterns matched the verb as `\w+`, so
  `Chompy tries to frenzy on orc taskmaster` yielded a target of `on orc taskmaster` — an entity
  that exists nowhere else. 134 lines. It carries no damage so it never reached the tables, but it
  did reach the classifier, where a phantom NPC can flip the mob that swung at it to friendly.
  Worse than a line failing to parse, because it parsed into something plausible.
- **Crit flags were tolerated but never read** on DoT and heal lines — every pattern allowed the
  trailing `(flag)` from the start, but only melee captured it. 289 DoT crits and 202 heal crits
  were counted as ordinary hits. Totals were always right; crit counts were not.
  `(Riposte Critical)` is a crit, and is caught, because the test is `/critical/i`.
- **No double counting.** Checked directly: same second, same attacker→target, same amount, two
  different event kinds. 176 hits out of ~500k damage events, and every one inspected was two
  genuinely separate events sharing a small number — a proc landing beside a melee swing, a DoT
  tick beside a crush. Nothing is counted twice.
- Also fixed: the twin-key separator was a **NUL**, which quietly made `engine.ts` binary to git
  and grep — diffs showed `Bin 59778 -> 60341 bytes` and `grep` matched nothing in the file. It is
  now a non-ASCII marker, which the ASCII log still cannot reach.

## Post-v1 — A charmed pet's damage to a boss, which two resets kept erasing  ✅
- A fire giant warrior charmed on and off through one Lord Nagafen fight dealt **36,439 damage
  over 609 hits** to the boss. The table showed **none** of it. Two independent causes:
  - **The charm flag is not a usable test of allegiance** when the pet shares a name with mobs we
    are killing: our swings at the *others* land on the shared key and break it, so the mob reads
    as un-charmed for most of the fight while plainly still fighting for us. Encounter tables now
    filter on `everCharmed` — charmed at any point in this fight — justified by the fact that
    nothing hostile has a reason to attack another mob.
  - **`resetNpcTracking` was wiping the pet's output** on every re-charm and on every death of
    anything sharing its name — about twenty times in that fight. It now clears a mob's outgoing
    damage from *friendly* victims only. Damage dealt to another mob is pet damage, banked in that
    mob's still-running encounter.
- Getting that second half wrong in the other direction is equally bad, and briefly was: preserving
  outgoing damage wholesale meant a respawn's damage to me never cleared, and the session's damage
  taken inflated **tenfold** (1.55M → 15.1M). Caught by the full-log check, not by the tests.
- Validated against the raw log rather than by eye: my damage to Lord Nagafen matches to the point
  (99,573 = 99,573), the pet's contribution matches exactly (19,680 + 16,759 = 36,439), and damage
  taken across the session went from 93.3% of ground truth to **99.1%**. Per-mob deltas elsewhere
  fall on both sides of zero, which is what rules out double counting — it would be uniformly
  positive. Charmed-pet rows 361 → **453**, damage they surface 382k → **544k**.

## Post-v1 — Wiki spell data, and naming the charms nobody's cast line announced  ✅
- **The drill-down splits into two rows.** Broad shape on top — total, then melee / spell / DoT,
  crits pinned right — and per-ability detail beneath. They were sharing one line and competing;
  the top row is the half that stays comparable between rows and between fights. An empty
  category dims rather than vanishing so the row keeps its shape.
- **Charm ownership, from the wiki.** Every spell page on [eqlwiki](https://eqlwiki.com/Category:Spells)
  carries a `Cast on Other Message`, which is the landing emote. That maps emote → spell →
  **class**: `has been charmed` is Enchanter (Charm/Beguile/Cajoling Whispers), `eyes glaze over`
  is Bard (Solon's Bewitching Bravura).
- **`/who` lines supply the other half** — 468 of them, and the only place the log ever states a
  class (`[32 PAL/MNK/ENC] Mirad (Iksar)`). So an Enchanter emote in a fight holding exactly one
  Enchanter names that Enchanter. Two, and it stays unowned: a coin flip on someone's damage is
  worse than an honest blank.
- Result: `Mirad` went from **absent** to 18 rows and 33,875 damage — the attribution the user
  could see in-game and the parser could not. Charmed-pet rows now 571 carrying 622k damage.
- **Only two of the four charm emotes are implemented.** `blinks` (Druid/Shaman) and `moans`
  (Necromancer) occur **zero** times in 875k lines and are generic enough to fire on ambient
  emotes, so recognising them would risk inventing pets for no observed gain.
- **The damage-type half of this turned out to be already solved, and that is worth recording:**
  every typed line states its element inline, and the only messages that *don't* name their
  source are three damage shields (thorns/flames/frost, now identified). Scraping all 1,965 spell
  pages would have bought nothing.

## Post-v1 — The encounter sparkline becomes a full-card diverging timeline  ✅
- The per-encounter strip was my damage only, on a fixed-width stub between header and table. It
  now **spans the full card width** with the My DPS chart's grammar: my damage above a baseline,
  what this mob dealt me below, each half scaled to its own peak.
- **It took two wrong turns to place it.** Behind the table first: the rows carry their own
  backgrounds, so it survived only in the gaps between columns and read as scattered blocks.
  Then over the table, which spans the full width but washes bars across every number and made
  the table genuinely hard to read. It ends up as its own band between header and table — full
  width, no overlap, and at full strength rather than hiding at 19% opacity.
- Needed one new piece of engine state: **`selfTaken`**, what each mob dealt *me*, timestamped and
  per-mob. `selfTakenComboLog` is per-session, so during a two-mob pull it would have drawn a
  strip that disagreed with the `tank` figure on the row directly above it — the same trap
  `selfHits` was added to avoid.
- **Bars are coloured by the stance combo of their bucket**, from the map the My DPS chart uses,
  so a combo means one colour everywhere. That map needed a third source: a timeline resolves a
  combo per *bucket*, so it routinely holds one that is neither any encounter's dominant combo
  nor an overview row — on a real boss fight that left **20 of 74 buckets** on the neutral
  fallback. Timeline combos are appended last, so slots the charts already agreed on never move.
- Mid-fight stance changes are rarer than expected — **1 encounter in 64** — because you don't
  reswitch during short trash pulls. It shows on the long boss fights, which is where it matters.

## Post-v1 — Best-guess charm ownership, and a cleanup pass  ✅
- Ambiguous charms now **name someone instead of nobody**. Ranking is by evidence — whoever has
  been seen casting a charm this session, then whoever cast most recently — and the card marks it
  with `ownerGuess` so the UI can append a `?` and italicise the name.
- **A resolved owner is remembered per mob.** That turned out to matter more than the guessing:
  a charm on a name we are also fighting breaks and re-infers constantly, and the re-inference
  has no landing message to work from, so the pet kept reverting to unowned. Unattributed pet
  damage fell 250,634 → **129,282** (76% of charmed-pet damage now owned); `Mirad` 18 → 39 rows.
- Cleanups from the audit: dropped `SHIELD_ELEMENTS` (an exported table nothing read — the same
  content lives in `LOG_FORMAT.md`, and a table no code consults drifts rather than helps), folded
  two near-identical owner-resolution blocks into `resolveCharmOwner`, dropped an unused import,
  and replaced the per-bucket `dominantComboIn` loop with a single pass (`comboPerBucket`).
- **The single-pass rewrite is not a speedup and shouldn't be sold as one**: 0.59ms → 0.56ms per
  `snapshot()`, inside the noise, because `comboSegments` is only ~210 entries on this log. What
  it removes is a factor that grows with session length, plus a comment that had drifted — the
  old one claimed it ran "once per encounter" when the timeline had made it run 40 times.
  Verified byte-identical against the naive version over the whole log before landing.

## Post-v1 — "What killed me"  ✅
- The backlog's own top pick, and it held up: **no new parsing**. Every field was already in the
  event stream, just never kept together — a rolling 10s window of incoming hits carrying the
  attacker and ability that the existing self-logs both drop, plus the heals that landed on me,
  folded into a `DeathReport` at the moment of death.
- Each death reports the **killing blow**, damage **by ability** and **by attacker**, healing
  received, and the stance combo I died in. The two breakdowns are the feature: dying to one
  thing and dying to six look nothing alike, and no total distinguishes them. A real death read
  `a festering hag 749 · a skeletal monk 162 · a greater dark bone 150 · a barbed bone skeleton
  106 · a dusty werebat 63` — an add problem, not a tanking one.
- **The window is fixed at 10s because the log makes the better question unanswerable**: hit
  points are never stated, so "since I was last at full" cannot be computed. Worth writing down
  so it isn't re-attempted.
- **"no heals" is printed rather than omitted** — on all 12 deaths in the log, nobody was healing.
  That is a finding, not an absence.
- Verified against the raw log: the Najena death reports 723 damage taken in its window, and an
  independent grep of every incoming-damage form over the same ten seconds also sums to 723, with
  the same killing blow (`Blaze` 209).

## Post-v1 — Collapsible boxes and long-term stats  ✅
- Three default-collapsed boxes between My DPS and the encounters, each opening on a single
  click anywhere in its header. The collapsed header is what is on screen almost always, so it
  carries a **summary** (`101 kills · 1h 36m since level 44`) — a box stating only its own name
  would be a button, not a panel.
- **Levels** and **Ability points** — a *history*, not a single figure: the stretch still running,
  then what each of the last **2 levels** and last **4 ability points** cost in kills, zones and
  combat time. Labelling a completed row by the milestone that ended it is what makes it readable
  as "level 44 cost 175 kills and 1h 29m"; on the real log level 43 took 2h 33m and level 44 took
  1h 29m, which is the comparison the box exists for.
  - Counters are monotonic session totals snapshotted at each milestone, so every figure is a
    subtraction of two anchors: O(1), and immune to `milestones` being trimmed as encounters age
    out — which would delete the anchor exactly when the stretch got long enough to matter.
    Keeping N spans needs N+1 anchors, and the span with no predecessor is dropped rather than
    shown as a running total wearing a delta's label.
  - Combat time sums *fight* spans, since fights never overlap and encounters do.
  - Ability-point rows all read `+2 AA`, so each carries the clock time it landed — otherwise
    four identical labels stack up with nothing to tell them apart.
- **Stances this zone** — seconds in each melee stance and invocation since last entering the
  current zone. Ends at wall-clock, not the last blow: standing in a stance between pulls is
  still time in it, and that is when you'd be reading the box. The still-open stance segment is
  clipped into the window too, or a stance you never changed reads as zero.
- **What killed me** became one of the same boxes rather than a bespoke panel.

## Post-v1 — AA terminology, and one tabbed container instead of four boxes  ✅
- **"AP"/"ability points" is now "AA"/Alternate Advancement** everywhere the user sees it, and the
  word "points" is gone. `LOG_FORMAT.md` keeps the game's own wording, because it quotes real log
  lines, and the parser's event kind stays `"ap"` for the same reason — it names the line it came
  from rather than the concept.
- **The four collapsible boxes became one container with a tab strip.** Closed, they cost four
  rows of a 540px panel to say nothing; as tabs that is a single row, and only the selected panel
  is mounted. Clicking the open tab closes it, so "all closed" stays one click away.
- Each tab carries a figure rather than just a noun (`Levels 1h 52m`, `Deaths 5`), since the strip
  is on screen permanently and should be worth reading unopened.
- Completed rows also name the **zone** the milestone landed in (`level 43 · Nagafen's Lair 3`),
  taken from the anchor rather than searched for. The open row has no milestone, so no zone.

## Post-v1 — Encounters end after 60s of quiet  ✅
- An encounter used to run from a mob's *first* contact to its last, however long the gap
  between. A boss that hit you once, was abandoned for fourteen minutes and then fought properly
  reported one encounter across the whole span, with every rate divided by the idle time. Real
  Lady Vox: **669s at 79 dps** before, **391s at 136 dps** after.
- A mob untouched for **60 seconds** now ends its encounter; the next blow starts a new one. The
  abandoned stretch is **discarded**, not banked — it is not a fight, and keeping it would put a
  fragment in the recent list and in every average. Dropping it also keeps its damage out of the
  stance overview for free, since that sums `selfComboLog` inside *encounter* windows.
- Separate from the fight timeout and shorter: a pull stays open while one mob is left alone.
  Encounter liveness in the UI now uses the same 60s, so a mob can't show as "active" after its
  tracking has already been reset.
- Log-wide: 3,748 → 4,157 encounters, mean duration 58s → 45s, and the engine's total self damage
  fell by 26,026 — exactly the abandoned stretches, and the right direction.

## Post-v1 — Charmed groupmates, and zoning as a hard encounter boundary  ✅
- **Charm flips allegiance, and it cuts both ways.** On a mob it makes them our pet; on one of
  *ours* it makes them the enemy. Only the first half was handled, so a charmed groupmate stayed
  `friendly` and the damage they were dealing the group went nowhere. A landing on a key that is
  already friendly now marks it `charmedAway` — seeded as an NPC, stripped from friendly — and
  released on the wear-off, on their death, and on zoning. A mob is an enemy at the instant its
  charm lands, which is exactly what tells the two cases apart. No occurrence in a 900k-line log
  yet; a long ongoing fight is where it will happen.
- **Zoning terminates every encounter, from either half of the transition.** `You have entered
  <zone>.` already did; `LOADING, PLEASE WAIT.` did not, and the two don't pair one-for-one
  (110 against 115 in a real log), so an encounter could span a transition. Only the named half
  moves the zone, counts a zone change or marks the timeline — counting both would double every
  zoning, and ignoring the unnamed one leaves the gap.
- Log-wide: +27 encounters from transitions that previously merged, no player gained an encounter,
  and the engine stays 0.65% above raw-log ground truth (the summoned-pet folding).

## Post-v1 — The My DPS panel can see the fight you are in  ✅
- **A regression from the 60s encounter timeout, and a latent bug it exposed.** The stance
  overview and history chart read only *finished* encounters, so they reported the combo you were
  in when the last mob died. On a long fight that is minutes stale; after a stance change it
  disagrees with the stance pill in the topbar. Tightening encounter spans narrowed the merged
  windows by ~30%, which pushed whole combos out of the 10/25 chips: a real snapshot went from 3
  combos to **1**, with the combo actually being fought missing.
- Both now merge the **live** encounters' spans in with the finished ones. On the same log that
  takes the n=10 window from 1 combo back to **4** — including the one switched to two seconds
  before the log ends — and the chart's newest bars carry the current combo's colour.
- A live encounter earns a **chart bar** only past 5s: a rate over one or two seconds is noise,
  and each half of the chart is scaled to its own peak, so one early crit would rescale every
  other bar. The overview has no threshold — seconds in a combo are seconds however few.
- Both caches are bypassed while a fight is open, since the window then moves on every blow.
  Measured: **0.58ms** per `snapshot()`, unchanged from the cached figure.

## Post-v1 — The encounter timeline becomes two charts  ✅
- Half the panel each, over **one shared time axis**. Left is me, unchanged: my damage above, what
  the mob dealt me below, coloured by the stance combo of each bucket. Right is **the mob**, and
  deliberately not filtered to me — everything the whole group dealt it above, everything it dealt
  the whole group below.
- The pair answers what neither half can alone: whether a lull was the mob surviving, the group
  stopping, or *me* dropping out while everyone else kept going.
- Needed two new engine series, `hitsOn` and `hitsBy` — every blow timestamped by target and by
  attacker. The existing self logs stay separate rather than being derived from them: the left
  chart is specifically mine, and filtering the wider logs per bucket would cost a scan per bar.
  Both are cleared with the mob's other tracking on reset.
- The `me` / `everyone` labels sit *over* the sparse top-left of their own chart; a label row of
  its own would cost 10px of a panel where vertical space is the scarce resource.
- **A rule with a notch separates the two.** Whitespace alone read as one wide chart with a
  stutter in it — the one reading that is actively wrong, since no bar on the left belongs to the
  series on the right. The notch sits at the divergence height, tying the baselines together.
- **The group chart went neutral after a colour collision.** It was `--player` green, which is the
  same family as `--s3` and `--s6` — two of the six stance slots — so whenever a combo landed on
  a green slot the two charts read as one series. Colour there encodes nothing anyway (one series,
  not six), so `--s-other` is both safer and more honest.
- Each chart's tooltip now spells out the axes: that bar height is a **rate** not a total, that
  each half is scaled to its own peak so heights never compare across the line or between charts,
  and that the line is zero. None of that is guessable from the bars.

## Post-v1 — A Windows launcher, and an audit pass  ✅
- **`start.bat`**, twin of `start.command`: check for Node, install on first run, build the UI,
  open the browser, serve in the foreground. Two Windows traps it has to dodge, both of which
  silently half-work otherwise — every `npm` call needs `call` (npm is a `.cmd`, so cmd.exe
  otherwise hands over control and the script just stops), and `cmd /c "…"` mis-parses nested
  quotes, so the delayed browser open leaves the URL unquoted and uses `ping` rather than
  `timeout`, which aborts when stdin is redirected as it is inside a detached `cmd`.
- **The Windows log path was wrong** and would never have found a real install: it used
  `homedir()`, but the game puts logs under the **Public** user. The macOS Wine bottle spells the
  right answer out — it mirrors `drive_c/users/Public/…` — so the layout below the drive root is
  now one shared constant across all three platforms.
- `.gitattributes` pins `*.bat` to CRLF and the shell launchers to LF.
- Audit fixes: hoisted a closure that was being allocated **on every damage event**, folded the
  three copies of "append a timestamped hit" into one helper, stopped recording the self in the
  group-wide hit logs (it can never be an encounter's subject, so those two entries only grow),
  and made the stat-tab bodies thunks — all four were being built on every render and three
  thrown away.
- **The launcher is untested**: there is no Windows machine here. It is checked statically only —
  balanced quotes, `call` on every npm invocation, CRLF endings.

## Post-v1 — Mote tracking  ✅
- A fifth tab: what each rung of the mote ladder last dropped, off which corpse, how often it is
  coming, and where the tiers come from.
- **The grid is the point.** Over the last 250 loots, tier against zone difficulty (D0 normal,
  D1 Awakened, D2 Adaptive, D3 Fused, D4 Refined). On a real log the ladder tracks the difficulty
  almost cleanly — D0 gives Infinitesimal and Minor, D3/D4 give Potential and Major — which is
  exactly the question "is it worth farming a harder instance" asks.
- **Two windows, because the two readings need different ones**: the grid wants the last 250
  loots whatever their tier; each tier's gap wants that tier's own last 10. A rare tier would
  fall out of a shared window entirely and never show a rate.
- **One row per tier, not two stacked tables.** The first cut put recency (last / from / gap) in
  one block and the difficulty grid in another, sharing only a tier column. The upper block was
  mostly whitespace at the real panel width, and comparing a tier's rate against where it drops
  meant matching names across a gap. Merged into a single underlined row per rung: identity and
  recency left, distribution right.
- **The window went 100 → 250** at the same time. Sized to the *sparsest* row that still has to
  be legible, not the densest: at 100 the Major row was two cells and read as noise.
- **A trailing `all` column** sums each row's difficulty cells, so the line adds up and the grand
  total lands on the window size. Not the same number as the all-time count beside the tier name,
  which is the point of keeping both.
- **Each row is shaded against its own maximum**, not the table's — a table-wide scale flattens
  every rare tier into one pale line (Major's nine drops against Minor's hundred). Per-row
  normalisation is what makes the diagonal legible at a glance.
- **The last eight drops sit above the table**, with timestamp, tier, corpse and zone. They come
  off the same 250-entry buffer the grid uses rather than a second log; the tier rows only keep
  the *latest* corpse, so this is the only place a run of drops is visible.
- The gap is withheld below 5 drops — three drops of a rare tier is not a rate, and printing one
  invites reading it as one. The sample count shows instead.
- Every rung appears including ones never seen, so the table reads as a ladder rather than a list
  of whatever happened to drop. A drop from before the first zone line is counted apart rather
  than called D0, which would be a different claim.
- Parsing needed one new event: the `--You have looted…--` form only, which is the "this is yours"
  one and the only form a mote uses. Anchored at `--` so the other ~5,100 loot lines fail on two
  characters.

## Post-v1 — An audit pass over the mote work  ✅
- **`noUnusedLocals` / `noUnusedParameters` are now on** in both tsconfigs. Both projects already
  passed, so it cost nothing and closes the gap that let a helper outlive its caller through a UI
  rewrite. The project has no linter and adding one would break the ~0-dependency rule; the
  compiler already had the check sitting behind a flag.
- **Dropped `DIFFICULTY_LABELS` / `DIFFICULTY_NAMES`** from `motes.ts` — exported, read by nothing.
  The UI carries its own copies, correctly: `web/` imports nothing from `src/`, the same boundary
  that makes the types mirrored. What the parser owns is the *contract* (a difficulty is 0–4 or
  null), not how it is spelled on screen.
  - **This is the second time an exported constant table went unread** — `SHIELD_ELEMENTS` was the
    first. Worth naming as a pattern: a table gets written while designing a feature, the feature
    ends up needing only the function beside it, and nothing ever fails. **`noUnusedLocals` does
    not catch this**, because `export` counts as a use. Until there is a tool for it, unread
    exports are a thing to look for by hand when auditing, not something the build will report.
- **Comment drift, all from the window widening**: four sites still said the grid covered the last
  100 loots after it moved to 250 (`src/types.ts` ×2, `web/src/types.ts`, `engine.ts`), and the
  recent-list comment still said five rows after it became eight.
- **`D_LABELS`, `D_NAMES` and `heat()` were being rebuilt on every render** of the stats panel and
  closed over nothing. Hoisted to module scope. The rationale comment above them had also drifted
  onto the wrong subject — it described the merged table, so it moved to the table.

## Post-v1 — The Plane of Sky class-quest tracker  ✅
- A third top-level tab beside Live and History: all 16 classes' Sky quests, one class at a time,
  with what each quest needs and whether it is held.
- **The catalogue is generated, not transcribed.** `scripts/build-sky-quests.mjs` fetches
  [the wiki page](https://eqlwiki.com/Plane_of_Sky) and writes `src/parser/sky-catalogue.ts` —
  16 classes, 95 quests, 127 item slots, 113 distinct components. It matches tables by their
  header row and throws on an unrecognised island tag, a class it cannot name or a reward it
  cannot parse, so a wiki change fails the run instead of quietly writing a thinner table. Baked
  into the binary rather than fetched at runtime: the app is offline-first.
- **Held-state is derived, never stored.** There is still no persistence in this app. The
  inventory export (`<Char>_<server>-Inventory.txt`, written by `/outputfile inventory`) is the
  baseline, and the log supplies everything looted after the file's mtime.
  - **The two halves must not overlap.** The export already counts what was looted before it was
    written, and backfill replays the *entire* log on every start — so adding every Sky pickup on
    top would double every item already held, every time. Only pickups after the mtime are added,
    and the cut-off is applied when the snapshot is built rather than when the line is read, so
    writing a fresh export re-baselines instantly with no replay. Three engine tests pin this.
- **The export has a second section, and a width check silently ate it.** After a blank line the
  file restarts with a `KeyRing / Name / ID` header and three-column rows. In a real export those
  17 rows share no item id with the main section — they are separate holdings, and high-end gear
  at that, which is exactly where a finished quest's reward would sit. Rows are now identified by
  their header (`Name` in column two) rather than by column count.
- **Upgrade suffixes fold away, and the item ids prove it rather than assume it.** EQL writes
  `Foo +4` and `Foo (Exaltation)`; both carry the *same* item id as `Foo`, verified across a real
  export. Matching also unifies the game's backtick apostrophe with the wiki's quote and ignores
  case (`Crown Of Elemental Mastery`).
- **The catalogue rides its own endpoint.** `GET /api/sky-quests`, fetched once and cached an
  hour. At 28KB of data that never changes for the life of the process, folding it into the
  snapshot would have added a third to every push for no new information.
- **Validated against the raw log, which is where the honest answer is.** A full replay of
  1,507,122 lines finds 570 loot lines, 220 distinct items and **zero** Sky items ever looted —
  correct for a level-15 character in a level-50+ zone. So the have-path is exercised by unit
  tests and a synthetic snapshot rather than by real holdings; that is a real limit on this
  work and is worth re-running the scan once the character is in the zone.
- **Known limit — 31 components have generic names** (`Brass Knuckles`, `Small Shield`,
  `Large Diamond`, `Golden Hilt`…). Matching is by name, so an ordinary gem of the same name
  counts. For most of these that is right — the turn-in *is* the common item — but nothing
  distinguishes the two cases without item ids the wiki does not publish.

## Post-v1 — The Sky tracker gains a by-island view  ✅
- A second view over the same data: every outstanding component across all 16 classes, grouped by
  where it drops. **By class** answers "how far along is my Bard"; **by island** answers "I am
  standing on Island 5, what do I look for" — and neither is a filter of the other, so they are
  views rather than a toggle on one table. On a fresh character that is 113 components over 9
  locations.
- **Sorted most-wanted first within each island.** Fourteen components are wanted by two different
  classes, and those are the ones worth learning to recognise on sight.
- **What is left out is the interesting part**, and each exclusion is a rule:
  - components of a **finished** quest — the turn-in consumed them, and listing them sends you
    farming for a reward already in the bag;
  - components **held in sufficient number** — where sufficient counts the *quests* that want it
    rather than one, because a turn-in consumes the item. One Leather Cord against a Beastlord and
    a Shaman quest reads `1/2` and stays on the list;
  - **runes** — *later corrected*: they are looted like everything else, and now appear. See
    "Wind runes are looted" below.
- **All 16 classes matter here, and that is a game mechanic rather than a preference.** EQL
  characters hold a *trio* of classes and can change the loadout at will, with the character's
  level being the lowest in the trio — which is why one log shows Sanluen as both `[44 PAL/MNK/BRD]`
  and `[17 WAR/DRU/MNK]`. Any class can become the current one, so a view that filtered to "my
  class" would be answering the wrong question.
- **The pure logic moved to [`web/src/sky-model.ts`](../web/src/sky-model.ts)**, apart from the
  panel — the `stats.ts` / `components.tsx` split. Nine tests cover the state machine and the
  three exclusions, including the two-reward Beastlord case and the wanted-twice case.
- **Two display fixes the screenshots caught.** The wiki mixes apostrophes (`Spiritualist\`s Ring`
  beside `Griffon's Beak`), which reads as a bug in a list — the generator now settles them on the
  straight quote, matching being unaffected either way. And a completed quest was still printing
  its component count (`0/1`), which reads as progress lost rather than a quest already done.

## Post-v1 — The loot form nobody had seen, and the export cue  ✅
Both halves came from playing with the tracker open, and the first was a silent data loss.

- **There is a second "this is yours" loot line, and it shares no punctuation with the first.**
  An item the game routes into an auto-storage is announced without the `--` fence, without the
  trailing full stop and in a different tense:
  `You looted a Wind Rune Azia from a thunder spirit's corpse and stored it in your currency`.
  Three destinations appear in a real log — `currency` (1), `tradeskill depot` (26) and
  `Dragon Hoard` (30). **Plane of Sky wind runes are routed to the currency tab**, so this was
  not a corner case: every rune looted was invisible. The `and stored it in your` literal is what
  keeps the ~5,400 "and sold it for…" lines out, since they match word for word up to the corpse.
- **The currency tab is not in the inventory export, which breaks the cut-off's assumption.**
  Pickups older than the export are normally discarded because the export already counts them.
  It cannot count what it cannot see: Azia was stored at 13:20:57 and is absent from an export
  written at 13:21:48, while two runes that went to a *bag* in the same minutes are both in it.
  So the cut-off was not preventing a double count there, it was deleting the item — permanently,
  since nothing else would restore it. Pickups into an unexported storage are now exempt.
  - `tradeskill depot` and `Dragon Hoard` are deliberately **not** exempt. A real export has
    carried a `Personal-Depot` section, so the depot is at least sometimes covered, and exempting
    a storage that *is* exported would double-count it. Erring toward the export is the safer
    side of that trade for storages no Sky item has been seen to use.
  - Accepted cost: a currency item spent on a turn-in stays on the tracker, because no export will
    ever contradict the log. That false positive beats the false negative it replaces.
- **`Outputfile Complete: <file>` is now a parsed event** and the cue to re-read the export. It
  never reaches the engine — the app owns the file — so `/outputfile inventory` refreshes the tab
  before you have alt-tabbed back, with the 3s mtime poll left as the backstop for an export
  written while the parser was not running. Mentioning the command in guild chat does not match,
  which a real log contains.
- **Validated by replaying all 1,513,274 lines.** Loot events 570 → 637 (57 of them stored), and
  Sky items found in the log went from **zero to five**: three wind runes into bags, Azia into the
  currency tab, and an Efreeti Scimitar — a Druid Test of Nature component — off **Noble Dojorn**,
  which is exactly the mob the generated catalogue's drop table names for it. That last one is an
  independent check on the wiki scrape as well as on the parser.

## Post-v1 — A progress box, and the island view grouped by mob  ✅
- **One box above both views**, carrying what is actionable now and what has just been finished.
  They belong together because they are a single story a step apart: a quest goes *ready*, you walk
  to the NPC, it becomes *complete*. It renders nothing when there is neither.
  - **Ready** is derived — every component held, reward not yet — and names the giver and the
    trigger phrase, so the row is the errand.
  - **Complete** is an *event*, not a derivation. `You have been given: <reward>` is the only line
    that **dates** a turn-in; holding the reward says a quest is finished but never when. So a
    quest completed before this log begins stays ✓ in the class view and is absent here, which is
    exactly what "recently" should mean. Three such lines exist in a real log and none is a Sky
    reward, so the parser stays general and the engine decides what counts.
- **The by-island view now nests rows under the mob that drops them**, because you kill mobs, not
  islands — and one boss usually owes you nearly everything: The Spiroc Lord holds 13 of Island 5's
  16, Sister of the Spire 15 of Island 7's 16. The heading is what turns a list into a plan.
  - **Grouping on the wiki's whole "drops from" string does not work**: it lists several mobs in no
    fixed order, so one boss fragments across headings — the Efreeti items alone spread over eight
    variants of "Noble Dojorn, …". The **first** named is the primary source, with a trailing
    parenthetical dropped so `Bazzt Zzzt (Island 6 Boss)` files with `Bazzt Zzzt`. Full list in the
    tooltip. Mobs sort by how much they owe you; the unsourced group always last.
- `parse:check` over 1,518,807 lines: 644 loot, 3 outputfile, 3 given, and **0 unparsed
  combat-relevant lines**.

## Post-v1 — Quantities, density, and a second unexported storage  ✅
- **Every held row prints `×N`.** Runes stack into one slot with a quantity beside them, and
  several classes want the same rune — so the old "have" hid the only figure that says whether
  one rune covers one quest or three. The `Count` column was already being read and summed
  across slots; this was purely a display that declined to show it.
- **The lists became responsive grids** — `repeat(auto-fit, minmax(300px, 1fr))` over quest
  blocks, islands and the pickup list, plus a tighter vertical rhythm and smaller class chips.
  The rest of the app is built for a ~540px side panel, but this is the tab you open wide, and
  past ~800px one column stopped adding information and started adding distance: a name at the
  left edge, its count pinned 400px away. At 830px the Bard's six quests now take three rows
  instead of six and all 16 class chips fit on one line; below ~640px it collapses back to the
  single column the panel was designed for. `auto-fit` rather than `auto-fill`, for the reason
  the stance tiles found — leftover tracks would strand half the width.
- **The Dragon Hoard turned out to be a second unexported storage**, found while screenshotting
  the density work: a Grey Damask Cloak — the Wizard's Test of Concentration component — had been
  routed there, which prompted running the same measurement used for the currency tab.
  - Of 19 distinct items stored in the hoard before an export, **12 appear nowhere in it**, and
    the 7 that do are in `Equipment` or a `Bank` slot — separate copies, not the hoard's
    contents. The file has no `Dragon Hoard` location at all. So it joins `currency` as exempt
    from the export cut-off; without this the cloak would have vanished on the next
    `/outputfile inventory`, exactly as Wind Rune Azia did.
  - The **tradeskill depot stays non-exempt, and that is now measured too**: an export carried a
    `Personal-Depot` section holding exactly the Black Sapphire, Blue Diamond and Darkbone Marrow
    the log had stored there. A later export shows none of them only because the depot had been
    emptied — which is why the test is "does the file have a section for it", not "is it empty
    today". The previous entry called this one caution; it is now evidence.

## Post-v1 — Tying the export to the selected character  ✅
- The inventory export is **derived from the active log**, by character and server, for the whole
  app: the game names `eqlog_<Char>_<server>.txt` and `<Char>_<server>-Inventory.txt` from the
  same two words, so switching the log picker moves the entire Sky tab with it. Nothing is
  configured and nothing is character-specific in the code — which is what makes it work for
  anyone who is not the person it was written for.
- **A missing export now names the file it is waiting for.** Previously the path was dropped when
  the file did not exist, so a character with no export got a generic "no export found" that
  could not say *which* file to write. `inventoryPath` is now always the path the selected log
  implies; `inventoryMs` is what says whether it was read.
- **That surfaced a real bug in the change test.** It compared only the mtime, and selecting a
  character with no export leaves the mtime `null` — which is what it already was — so the check
  short-circuited and the newly built engine was never handed the path. `setActiveLog` replaces
  the engine, so "nothing changed" is never true across a switch. The test is now the path *and*
  the mtime. Found by actually switching characters, not by reading the code.
- Verified end-to-end against both real logs: `freeport` → its export, 130 items, 14 held;
  `qeynos` → correctly names `Sanluen_qeynos-Inventory.txt`, reports it unread, 0 held; and back
  again. Plus a fallback to the log's own folder for a copied pair, and unit cases for a server
  name containing underscores.

## Post-v1 — An efficiency audit over the Sky work  ✅
Measured first, then fixed only what the measurements justified. The headline is that the new
code is not a performance problem: the numbers below are all small, and two candidate
optimisations were **rejected** for costing more in complexity than they save.

- **The 3s poll read and parsed the whole export every tick and discarded it** — while its own
  comment claimed to be "one `stat` … re-parsing 400 lines every 3s would be pure waste". The
  comment described the intent and the code did the opposite. Now stats first and reads only on
  a change: **0.1237ms → 0.0015ms** per tick (82×). Small either way; the point is that the code
  now does what it says.
- **`logIdentity` duplicated `parseLogFileName`'s regex.** `config.ts` already owned how a log
  file name splits into character and server, and `inventory.ts` had a second copy — one more
  place to forget if the game ever renames its files. Collapsed onto the shared function.
- **`groupByMob` ran per island on every React render**, rebuilding a Map each time, though
  nothing it depends on changes between renders that `held` does not. Folded into the existing
  `useMemo` beside `buildNeeds`.
- **`ClassView` recomputed a count `doneByClass` already held**, walking the class's quests a
  second time to produce a number the chips had computed. Now reads the map.
- **Measured and left alone**, so the reasoning is not re-derived:
  - *The prefilter additions.* `Outputfile` and `been given` took `RELEVANT_RE` from 106.3 to
    114.2 ns/line — but the prefilter is ~13% of `parseLine`, so this is ~1% overall, about 23ms
    across a full 1.5M-line backfill. Both tokens are already last in the alternation, which is
    where the rarest belong.
  - *Caching the inventory fold.* `buildSkyStats` re-normalises ~100 inventory keys per push, and
    the whole call costs **0.024ms**. Hoisting it into `setInventory` would add a cache field and
    an invalidation path to save nothing measurable.
  - *Pre-serialising the catalogue.* `/api/sky-quests` stringifies 24KB per request, but the
    browser caches it for an hour, so it runs about once per session.

## Post-v1 — The island view shows what is settled, not just what is missing  ✅
- **Components you already hold, or have already turned in, now stay on their island** and sort
  to the foot of it under a `have / turned in` heading, dimmed. The header carries both figures —
  `ISLAND 3 — HARPY  13 +1`.
- **Why the earlier cut was wrong.** Dropping a component the moment it was answered kept the list
  tight as a plan, but made an island unreadable as a *place*: "Island 5 wants nothing more from
  me" and "Island 5 was never in this list" rendered identically, and only one of those is worth
  knowing when you are standing on it.
- **Three states, and the arithmetic behind them.** `need` counts only the **unfinished** quests
  wanting an item, because a turn-in consumes its components — so finishing one of two quests
  that share a component drops what it asks for from two to one. `need === 0` is `done`,
  `held >= need` is `held`, anything else is `needed`.
- **The settled block is deliberately not grouped by mob.** The mob heading answers "where would I
  farm this", which is the one question a row you have already settled does not raise. The
  outstanding rows keep their mob grouping, since that is still a plan.
- `buildNeeds` became `buildIslands` and returns an island at a time — outstanding rows grouped by
  mob, settled rows flat, and both counts — rather than a bare list with the answered rows
  filtered out. Eight model tests cover the states, the shared-component arithmetic and the
  ordering.

## Post-v1 — Wind runes are looted, and readiness was overstated because of it  ✅
- **The premise was wrong.** The tracker treated a Wind Rune as a formality the quest giver would
  hand over on request — the rune row even read "ask the giver". The wiki says plainly that the
  runes "drop from all mobs in the Plane of Sky, and many players simply farm the trash mobs on
  one of the early islands", and the log had been saying so all along: runes looted off a thunder
  spirit, Protector of Sky, an azarack, Gorgalosk. The evidence was on screen and went
  unreconciled with the assumption.
- **The cost was a panel that lied about what was ready.** `progressOf` left the rune out of the
  tally, so any quest whose other components were in the bag reported itself ready to hand in.
  Against the real inventory: **13 quests claimed ready, 7 actually were** — and each of the six
  differences was exactly one rune short (Dena ×3, Neza ×2, Geza ×1).
- **A rune is now a component like any other**, via `questParts` — no privileged member, counted
  in `have`/`need`, and required for `ready`.
- **The island view gains a Wind Runes group, sorted first.** They drop everywhere, so filing them
  under one island would be a claim the wiki contradicts; the group's mob heading is "any mob in
  the Plane of Sky". It leads the list because a rune is wanted by six or seven quests on average
  — the biggest single thing to farm, not a footnote. On a real inventory it reads
  `Wind Rune Dena … ×7` (none held, seven quests want one) beside `Wind Rune Lena … 5/6`.
- **Per-quest readiness stays local on purpose**: it asks whether the parts are in the bag, not
  whether there are enough to go round, because you genuinely can turn *this* one in now. The
  aggregate shortfall is what the rune group is for.

## Post-v1 — Proving the export path is relative, not just believing it  ✅
- The export was already located relative to the open log rather than from any absolute root, but
  the claim rested on a comment. The path derivation is now **pure and IO-free**
  (`inventoryCandidates`), split from the existence check, so it can be run against `path.win32`
  from a Mac — the Windows layout is checked rather than asserted.
- **The rule is `dirname` twice**: once to the logs folder, once to the directory that holds it.
  Nothing depends on that folder being called `logs`, on how deep the install sits, or on the OS;
  `path.join` supplies the host's separator. Verified against four layouts — the Windows install
  under `C:\Users\Public\…`, the macOS Wine bottle, a Linux `~/.wine` bottle, and a custom
  `EQL_LOG_DIR` — plus a relative log path, which stays relative rather than resolving against
  cwd.
- Discovering the logs folder in the first place stays the one genuinely platform-branched thing,
  and it stays in `config.ts` where it already was.

## Post-v1 — A folder picker for the logs directory  ✅
- **Browse… beside the path box**, so the logs folder can be chosen instead of typed. Typing
  survives alongside it: a path pasted from somewhere else is quicker than navigating to it.
- **It has to be server-side, and that is not a shortcut.** The browser's own choosers cannot
  supply an absolute path — `showDirectoryPicker()` returns an opaque handle and
  `<input webkitdirectory>` returns paths relative to the folder you picked. Both withhold it
  deliberately, and it is the only thing the backend can act on. So `/api/browse` lists
  directories and the UI renders them; the server already binds to 127.0.0.1 and exists to read
  this machine's disk.
- **Every row carries its log count**, which is what makes the picker quick rather than merely
  possible — and it earned that immediately: this install's folder is called `Logs`, not `logs`,
  so the badge is a better signal than the name. One `readdir` per subdirectory, ~47ms on the
  6,156-entry install folder, capped at 100 subdirectories so the cost is bounded and not just
  small in practice.
- Opens where the app is already pointed; shortcuts for the platform's expected install and home,
  offered only when they exist. Symlinked directories are followed — `Dirent.isDirectory()` is
  false for them and a Wine bottle is often laid out that way.
- **Two things the screenshot caught.** `direction: rtl` — the usual one-liner for truncating a
  path from the left — reorders the leading `/` of an absolute path to the far end, so
  `/Users/andrew/…` rendered as `…/andrew/…/` with a slash that is not in the path; replaced with
  an explicit head/tail split where only the head shrinks. And the panel could not be
  photographed at all until the list was split from the fetching (`FolderList` / `FolderPicker`),
  because the live app holds an SSE connection open and headless Chrome never settles.

## Post-v1 — Helper text, a README for users, and a case bug it uncovered  ✅
- **The folder picker now says what it wants.** "Choose a folder" left you guessing between the
  game folder, the install root and the logs folder itself; it now states that it wants the folder
  *containing* `eqlog_<Character>_<server>.txt`, names the usual location, and explains the count
  badge. The confirm button's tooltip differs by state — how many logs it found, or what will
  happen if you pick a folder with none — and an empty folder says whether to use it or go back up.
- **The README was rewritten for people who did not build it**: what the tool gives you, how to set
  it up (including `/log on`, which is easy to forget), a tab-by-tab guide to reading the interface,
  and how the Plane of Sky tracker is fed. It had been a developer's file describing milestones.
- **Writing the setup section found a real cross-platform bug.** The game creates the folder as
  `Logs`; `config.ts` has always looked for `logs`. macOS and Windows are case-insensitive by
  default so it never showed here — on a Wine bottle on a case-sensitive Linux filesystem the app
  would report no logs on a machine full of them. `resolveLogDir` now retries case-insensitively on
  the last segment.
  - The test for it cannot assert the resolved *string*: a case-insensitive host satisfies the
    direct stat and returns the spelling asked for, a case-sensitive one falls through and returns
    the real name. It asserts the invariant that holds on both — the folder is found, and it is the
    one holding the log.

## Post-v1 — Windows gaps in the folder picker  ✅
Prompted by a friend testing on Windows successfully — but on a build from *before* the picker
existed, so the picker itself was unverified there. Reviewing it against `path.win32` found one
real gap and one rough edge.

- **The picker could never leave the drive it opened on.** Windows has no single filesystem root:
  `path.dirname("C:\")` is `C:\`, so "up" terminates at the drive. A game installed on `D:` was
  unreachable except by typing the path — the exact thing the picker is for. The shortcut row now
  lists the machine's drives on Windows. The 26-letter probe is win32-only and cached for the
  process: drives do not come and go mid-session, and a mapped network drive makes the stat far
  from free.
- **A missing start folder opened the picker on an error.** The fallback chain now filters by
  existence, so a first run lands somewhere readable. A folder the user *explicitly asked for* is
  still reported missing, because silently redirecting a mistyped path makes it look like it
  worked.
- Everything else checked out against `path.win32`: `dirname` walks correctly, the separator
  choice in `joinPath` and the path label picks `\` for a Windows path and `/` otherwise, and
  `encodeURIComponent` round-trips backslashes through the query string.

## Post-v1 — Second audit, over the tracker and the picker  ✅
Measured before changing anything, as last time. **Nothing here was a performance problem**, and
saying so is the finding: the numbers are recorded so the next pass does not re-derive them.

| Path | Cost | When |
|---|---|---|
| `buildIslands` (island view, now including runes) | 0.082ms | memoised, per `held` change |
| `readyQuests` (progress box) | 0.006ms | memoised |
| `doneByClass` (chip badges) | 0.006ms | memoised |
| `browseDir` on the 6,156-entry install folder | 6.8ms | once per click |
| `browseDir` on the logs folder | 0.019ms | once per click |

- **Three full passes over the 95 quests per render** (`buildIslands`, `readyQuests`,
  `doneByClass`) total ~0.09ms and are separately memoised. Merging them into one walk was
  considered and **rejected**: it would couple three independent views to one shared result to
  save under a tenth of a millisecond.
- **The `eqlog_*.txt` naming rule was stated in two places** — `listLogs` and the picker's
  per-directory count — and is now `isLogFileName` in `config.ts`, beside `parseLogFileName`
  which already owned the other half of the same rule.
- **The picker derived the path separator twice**, in the label and in the join, from the same
  expression. One disagreeing with the other would corrupt navigation on Windows specifically, so
  it is now stated once in `separatorOf`.
- **`questParts` was exported and read only inside its own file.** Un-exported. This is the third
  time this pattern has come up (`SHIELD_ELEMENTS`, `DIFFICULTY_LABELS`), and `noUnusedLocals`
  still cannot see it because `export` counts as a use — it remains a thing to check by hand.
  - Judged and **kept**: `inventoryCandidates`, `skyItemNames`, `primaryMob`, `islandOrder`,
    `RUNE_GROUP` are read by tests asserting invariants over otherwise-private state, and
    `FolderList` is the seam that makes the picker screenshot-able at all. Those are readers, just
    not production ones.

## Post-v1 — A turn-in takes its parts back off the count  ✅
- **The gap this closes**: the count only ever went up. Acquisitions came from the export plus the
  log; nothing represented an item *leaving*. For bag items the next export corrected it, but the
  currency tab and the Dragon Hoard are not in the export, so a wind rune spent on a turn-in stayed
  counted for good — and runes are the tracker's most-used figure.
- `You have been given: <reward>` already identified the finished quest; `questConsumedFor` now maps
  that reward to the rune and components the turn-in consumed, and `buildSkyStats` subtracts them.
- **Consumption obeys the same cut-off as acquisition**, which is the whole correctness argument:
  - *after* the export → subtract (the export counted something since handed in);
  - *before* the export → do **not** (the export already shows the loss; subtracting would count it
    twice and drive the count negative);
  - *from an unexported storage* → always subtract, because the acquisition bypassed the cut-off
    too. Six engine tests, one per branch.
- Deduplicated by **quest**, not reward — Beastlord's Test of Claw hands over two items and
  consumes its parts once. Counts clamp at zero, for a turn-in witnessed on an item whose pickup
  predates the log.
- **Changes nothing today, and that is the honest result**: a full replay finds three
  `You have been given` lines in the log and none is a Sky reward, so no count moves until the
  first real turn-in. Verified rather than assumed.

## Post-v1 — A charm landing is not a charm  ✅
Reported as "an encounter for *a greater sphinx* keeps completing and restarting". It was not the
sphinx — it was the player's own bard song.

- **The cause.** `<mob>'s eyes glaze over` is shared by Solon's Bewitching Bravura (charm) and the
  mesmerise songs, and a charm song **pulses onto whatever is in range**, including the mob the
  group is killing. The engine read each landing as "one name, two separate lives", banked the
  encounter and wiped its tracking; the next swing opened a fresh one.
- **The evidence.** Of 24 landings on a greater sphinx, **23 broke within five seconds** to the
  group's own attacks, median gap **one second**, and the song never once wore off one naturally —
  while it holds fine on imp protectors (469 wear-offs), fire giant warriors (295) and Lord Nagafen
  (159). Replaying the session: the encounter opened **21 times and lost progress 21 times** in six
  minutes. Not sphinx-specific — **674 landings across 70 mob names**.
- **The fix.** A landing goes to `pendingCharms` and affects nothing until the mob does something
  only a pet does: attacks another mob, or calls you Master. That instant is also where the two
  lives divide, so it is where the bank now happens. A landing broken before then never happened.
- **A bug found inside the fix**: `confirmCharmByMaster` resolved kinds *after* putting the charm
  in force, so the mob already read as ours and the bank was skipped — merging the enemy life into
  the pet's. Caught by an existing test asserting post-charm damage lands on the enemy twin.
- **Validated against the raw log**, per the rule that unit tests pass through what this catches:
  a full 1.63M-line replay gives **identical** session damage (814,507) and damage taken (322,109),
  while the sphinx window opens **5 encounters instead of 21** — exactly the five sphinx deaths in
  it — with peak total up from 12,838 to 30,886.

## Post-v1 — Turn-ins are trades, and the counts were wrong three ways  ✅
Reported as "the tracker says I still have runes I no longer have, and lists 3 High Quality Raiment
when I have none". Three separate faults, all found by comparing the tracker against the export
item by item.

- **The reward-based turn-in detection never fired.** A real log writes **no** reward line for a Sky
  turn-in — the three `You have been given` lines in 1.6M are all something else. Handing a quest in
  is a **trade**, and `You offered <n> <item> to <npc>.` followed by `You complete the trade with
  <npc>.` is the actual record. That line is the only one in the log that says anything **left** the
  bags, which is why the counts could only ever rise. Offers are buffered until the completion,
  since an offer alone may still be cancelled.
- **The Dragon Hoard should never have been exempt from the export cut-off.** The measurement that
  put it there was confounded: "12 of 19 hoard items appear nowhere in the export" was true because
  those items had been *spent* in between, not because the export cannot see them. Items that were
  not spent do appear — 2 hoard pickups of an Efreeti War Spear, none offered, and the export holds
  it. Exempting it added every pickup on top of an export that already counted them, which is
  exactly the "3 High Quality Raiment" that was reported.
- **Completions were capped at ten**, so the three oldest silently disappeared — and since the UI
  now marks quests done from that list, truncating it would un-finish them. Uncapped; 95 is the
  ceiling.
- **Completion is now permanent** and drives the panel. It is an event, so `progressOf` trusts it
  over holding the reward: banking, selling or handing the reward to an alt no longer un-finishes a
  quest. Holding the reward stays the fallback for a completion never witnessed.
- **Every holding reports where it is** — `inv`, `bank`, `shared`, `depot`, `keyring`, `DH`,
  `currency` — from the export's slot, or the storage the log named when the export cannot see it.
- **Validated item by item against the export**, which is the invariant that matters: of the 33 Sky
  items the export can see, the tracker now agrees on **33** (it disagreed on several before). The
  only log-only holdings left are the nine currency runes, correctly labelled. Thirteen completed
  quests are recognised from the trades, where zero were before.

## Backlog (engine already supports the shape)
- ~~Real spell-name mapping for non-melee "effect" messages via a damage-message table~~ — **done
  cheaply and closed**: a real log contains exactly three such messages (thorns/flames/frost), now
  identified in `LOG_FORMAT.md`. Every other damage line states its element inline, so the full
  1,965-page spell scrape this entry imagined would buy nothing.
- Fight export/share (JSON/image) and run-over-run comparison. Needs the first **persistence** in the
  app: today the log file *is* the store and backfill re-derives everything in ~25s, so this only earns
  its keep across log rotations.
- Optional true always-on-top overlay (revisit Tauri/Electron only if the browser window proves insufficient).

### Known bug — a groupmate accumulating an encounter
- **An encounter named `Ranshi` (a groupmate) spans 12,597s and credits me 19,424 damage I never
  dealt them** — the log shows 48. Pre-existing and unchanged by the encounter-timeout work
  (verified identical before and after). It never goes idle because Ranshi is constantly fighting
  something, so it accumulates for the whole session. Two things to look at: why a groupmate is
  classified as an NPC at all, and where `perTarget[ranshi][self]` gets 19k from. Worth fixing —
  it is the largest single misattribution left in the log.

### ~~Known limitation — spent items from unexported storages are never released~~ — **fixed**
Turn-ins now deduct what they consumed (see the Post-v1 entry below). What remains is only a
turn-in made while the app was not running.

<details><summary>The original entry, kept for the reasoning</summary>

- The currency tab and the Dragon Hoard have no section in the inventory export, so pickups routed
  there are exempt from the export's cut-off and counted purely from the log. That is what makes
  them visible at all — but it also means **nothing ever removes them**. A wind rune spent on a
  turn-in stays on the count; a re-export cannot contradict it (there is nothing in the export to
  disagree with) and a restart replays the same pickups. Measured: three `Wind Rune Azia` pickups
  in the log, all to currency, counted as 3 whatever the inventory now holds.
- **The fix is available and not large.** `You have been given: <reward>` already identifies the
  finished quest, and `questParts` already knows what that quest consumed — so a completion could
  decrement the parts it used from the log-derived counts. Not done yet because it wants care over
  the case where the same rune is held for several quests, and over turn-ins that happened before
  the app was watching.
- Documented in the README rather than left to be discovered, since runes are exactly the item this
  bites and the tracker's rune counts are its most-used figure.
</details>

### Charm/pet work that is still open
- **The two unimplemented charm emotes** — `<mob> blinks.` (Druid/Shaman) and `<mob> moans.`
  (Necromancer). Zero occurrences in 875k lines and generic enough to fire on ambient emotes, so
  they wait for a log that actually shows one. The table in `spells.ts` already names them.
- **139 pet rows (129k damage) still have no owner**, almost all because no `/who` ever covered the
  charmer. A `/who` costs the user one keystroke; a nudge in the UI when an unowned pet appears would
  convert most of them. Cheap, and the highest-value remaining charm item.
- **Charm uptime** — the engine knows every charm window; "your pet was yours for 71% of that fight"
  is a bard/enchanter metric nothing else reports.

### Weighed on 2026-07-29 and not taken (yet)
Kept here so the reasoning isn't re-derived. Ranked by value-per-effort as judged then:
- **Ability-level efficiency over the window** — crit and miss rates per ability across the last N
  encounters rather than one fight, turning the drill-down into "your crush crits 12%, your smite 4%".
- **Prescriptive stance cards** — the tiles report each combo's DPS and defensive cost but never say
  *switch*; `seconds` per combo is already the confidence needed to suppress a thin-sample suggestion.
- **A second line on the history chart** at the panel header's combat-clock figure, so the gap between
  the two averages is visible on the chart instead of explained in a tooltip.
- **`scaleK` past 100k** prints `1284k` rather than `1.28M` — visible on long boss fights and tank
  totals. One line, whenever it next annoys.

### Weighed on 2026-07-30 and not taken
- **An element dimension** (fire/cold/magic/poison/disease) alongside the melee/spell/dot split. Every
  typed line now carries its element, so the data is *there* — but `DamageType` means mechanism, and
  adding a second axis touches the types, the engine's `byType`, the drill-down row and the History
  pane. Worth it only if "what resists me" becomes a question you're asking.
- **Merging `EncounterTimeline` with `EncounterHistory`** — both draw diverging stance-coloured bars.
  Left separate deliberately: the history chart also carries milestones, hover readout, an average
  line and per-point titles, and folding the plain strip into it would cost more in options than it
  saves in lines.
- **Trimming `comboSegments`** — it grows for the life of the session (one entry per stance change,
  ~210 over 875k lines). Bounded in practice, and everything that walks it is now single-pass, so
  there is nothing to fix until a session gets far longer.
- ~~**`.erow.pet` / `.erow.npc` fills are unreachable**~~ — `.erow.pet` is now the charmed-pet row,
  which is exactly the "mob as a row" this entry was holding the styling for. `.erow.npc` is still
  unreachable and still deliberate.

## Post-v1 — A critical-hit tracker  ✅
A fourth top-level tab: of the times I dealt damage, how often did it crit, and how hard. Self only
and session-wide — a crit rate is a property of the character, not of a fight, and it needs volume
before the percentage settles.

**Three things the log turned out to be doing, none of them guessable from the code:**
- **Three crits never say "Critical".** `(Crippling Blow)`, `(Slay Undead)` and `(Finishing Blow)`
  are critical hits emitted *instead of* `(Critical)`, never beside it. The old
  `/critical/i.test(modifier)` scored all 589 of them as ordinary hits; 107 were the self's own, and
  reading them moves the melee crit rate 8.24% → 8.32%. `(Riposte)`, `(Strikethrough)`, `(Flurry)`,
  `(Rampage)` and `(Double Bow Shot)` stay out — those say how a swing resolved or that it was an
  extra one, which is a different question.
- **Flags compose.** `(Riposte Strikethrough Critical)`, `(Critical Double Bow Shot)` and
  `(Riposte Crippling Blow)` all occur, so reading one is a search, not a match.
- **Spell damage arrives in two forms and only one can crit.** Named abilities
  (`…84 points of fire damage by Ignite.`) carry flags; the `non-melee` form — every proc and damage
  shield — has **never once** carried one in 2M lines. Folded together they would divide 5 crits by
  55,000 hits and call it a spell crit rate. `SpellDamageEvent` now carries a `form`, procs get
  their own row marked "cannot crit", and the spell rate divides by the 15,528 hits that could
  actually have critted.

**Reconciled against the raw log**, category by category, engine total vs. independent grep:
melee 131,372 hits / 10,954 crits · spells 15,528 / 5 · DoT 78,050 / 647 · heals 42,626 / 25 ·
procs 39,563 / 0. Every one exact. Heals are recorded *before* the fight guard the other heal
figures sit behind, so the denominator is every heal cast rather than every heal cast in combat —
which is also what the grep counts.

**Measured, and nothing needed optimising:** full-log replay 14.7s against a 15.0s baseline (inside
the noise), `snapshot()` 0.081ms → 0.088ms for the ledger rebuild at ~5 pushes/sec. Fixed size
regardless of session length, so no trimming and no cache.

**Two thin-sample thresholds, because the figures have different denominators.** `THIN_SAMPLE`
(100 hits) governs the rate; `THIN_CRITS` (20 crits) governs the damage share and the
crit-vs-normal multiplier, which divide by crits alone. Without the second, this character's
spells reported "0.90× a normal hit" off five crits — noise presented as a finding.

**Also fixed here:** `npm test` carried `--test-force-exit`, which truncated the TAP output mid-run
once the engine test file grew — the tally wobbled between 244 and 252 and a failing test near the
end could have been dropped silently. The flag is no longer needed: the suite exits cleanly on its
own in ~2.3s, and now reports a stable 260.

**A records board leads the tab** — biggest melee, spell and DoT crit, with what did it, to whom
and when. Records over the **active log**, since the engine replays all of it on start.

**It needed a second record per category, and the reason is not a corner case.** The hardest thing
you land is not always a crit: the biggest spell hit in this log is a **647 Denon's Desperate Dirge
that never critted**, against a biggest spell *crit* of 220 — and the biggest heal is a 6,253 Lay
on Hands X, likewise not a crit. A board holding only crits reports 220 and looks broken to anyone
who watched the 647 land, so `bestHit` (biggest hit of any kind, `kind: null` when it wasn't a
crit) sits beside `best`, and a tile prints it only when the two differ. Verified per category
against the raw log: melee 629, spell 647, DoT 201, heal 6,253, proc 26 — all exact.

**Not taken:** a crit rate per encounter window (10/25/50) to match the DPS chart. A 30-second pull
is twenty swings, so the small windows would report noise, and the question "did that AA move my
crit rate" wants a before/after the app cannot express anyway.

## Post-v1 — Cap the Sky tracker's completed list  ✅
"Recently complete" listed every turn-in the log had ever witnessed — 36 of them in a real log,
each row pushing "Ready to turn in" further down the panel. That is backwards: the completed half
is a record, the ready half is the half you act on. Capped at 10, newest first, with what is held
back said outright ("+26 earlier") instead of silently dropped.

**The cap is display-only, and that is the whole subtlety.** The same `completed` array feeds
`completedQuestNames`, which marks a quest ✓ in the class and island views. Capping what reaches
*that* would un-finish every turn-in past the tenth — already-handed-in quests reading as ready
again, sending you back to an NPC with nothing left for you. A test pins it, because the bug would
be invisible in the capped list itself.

The "+N earlier" count is taken from the *resolved* completions rather than the raw array: a
handover that is no quest reward was never going to be listed, so counting it as held back would
overstate what is hidden.

## Post-v1 — Crit windows: session / 25 / 100 fights / 2 weeks  ✅
The crit tab was one number per category over the whole log, which answers "what is my rate" and
nothing else. Four windows now, with the all-time record badges deliberately outside all of them.
It pays immediately: this character's melee rate is **8.37% over two weeks and 11.76% this
session**, and DoT **0.86%** against **7.82%** — a change no single figure could show.

**A session needed a real boundary, and the log has one.** `Welcome to EverQuest Legends!`, 19 in a
2M-line log, exact wording stable across all of them. Capped at 12 hours: a client left logged in
overnight would otherwise fold yesterday's raid into "tonight". With no marker at all — a log that
begins mid-session — the cap is the whole answer.

**Windowing needs history the engine did not keep**, so the ledger gained a per-hit log: ~309,000
entries over this log, trimmed to 14 days (the longest window, so nothing retained is unreachable
and nothing reachable is missing). Costs **31MB** (54 → 85MB heap on a full replay) and nothing
measurable on the hot path — replay 14.9s against a 15.0s baseline. Entries hold indices into a
shared name table rather than strings, for the target as well as the ability, since a window's best
crit still has to name what it hit.

**The all-time accumulators stayed.** The records badges must outlive the 14-day trim — a personal
best from three weeks ago disappearing would be a bug, not a policy — so they are kept separately
and O(1) per hit.

**"The last N encounters" walks the stamps rather than subtracting from the counter.** Subtracting
is off by one the moment no fight is in progress, which is most of the time: it reported 24 for a
25-encounter window. The test that caught it is kept. Walking is also the honest meaning —
*encounters I fought in*, since one stood through without swinging leaves no entry either way.

**Measured, then fixed, then measured again.** Filtering the encounter windows inside the loop
walked all 309,000 entries to reach the last 25 — 6.4ms to read 825 hits. Both keys rise along the
log, so one binary search finds the start on either axis: **0.16ms**, 40× better. Lowercasing the
ability name per entry was the other 40% of a rebuild, so the name table carries a lowercased copy.
`d14` still walks everything at 16ms, cached on the log's length so the panel's 4s poll is free
while idle — which is exactly when someone parks on the two-week view.

**Served from `/api/crits`, not pushed.** Four windows is 72KB against a 92KB snapshot at ~5/sec,
for tables one tab reads — the same trade that keeps the Sky catalogue out of the stream. The
badges and the recent-crits strip stay in the snapshot, so the live half of the panel is still
live; the tables poll every 4s, which a rate over 100 fights cannot outrun.

**Validated against the raw log**, not just the tests: the session window's own bounds were taken
from the engine and every figure inside them re-counted from the raw lines — melee 910 hits / 107
crits / 131,334 damage, spells 105/0, DoT 307/24, heals 740/0, procs 0/0. All five categories exact
on all three figures.

## Post-v1 — Expand an encounter to everyone who fought it  ✅
The encounter table showed six rows because the *engine* sent six: `encounterView` built a card
per contributor, sorted them, then kept `self + top 5` and threw the rest away. A truncation taken
there is one the UI can never undo — the tail was gone before it reached the browser.

**It was hiding real damage.** Replaying the whole log: encounters run to **10 contributors**, and
the rows the cut discarded were **up to 15.1% of the mob's damage** — 13.2% on a 10-card fire giant
pull, 15.1% on King Tranix. A raid meter that silently omits a seventh of a boss fight is answering
a different question than the one being asked of it.

`cards` is now the whole ranked list; the table opens on six and folds the rest behind a quiet
`▸ 4 more` row that expands to everyone. Six is exactly what the engine used to send, so an
ordinary group fight looks identical and nobody has to click for the behaviour they already had.

**The fold's row carries the tail's share of the encounter**, because `+4 more` alone cannot tell
four archers who each landed a shot from half a raid — the number is what says whether opening it
is worth doing. It sits in the bar column so it lines up under the other percentages; at the panel's
right edge it landed under `time` and read as a duration, which the first screenshot caught.

**Your own row is still held in the opening six however far down you rank.** That was the only
thing the engine's splice was really for, and it moved to the client with it (`foldEncounterCards`,
tested there): on a night spent healing you are nowhere near the top of a damage ranking, and a
meter that cannot show you yourself without a click is worse than one that never had the rest.

**Cost was measured before shipping, not assumed.** A card is ~1KB and the median encounter has 5,
so sending every contributor moved the snapshot by a few KB against 90KB — nowhere near the trade
that keeps the crit tables and the Sky catalogue out of the stream.

## Post-v1 — Expanding an encounter opens every row's breakdown  ✅
Unfolding a raid encounter answered "who else was here" and then asked for ten more clicks to
learn what any of them did. The fold now opens each row's drill-down with it, and closes them
again on the way back — the only inverse that leaves the table as it was found.

**A batch set, not a toggle, and that is the whole design decision.** Calling the existing
per-key `toggle` once per row would *close* whichever rows you had already opened by hand, so the
button would mean something different depending on what you had clicked before pressing it.
`onSetOpen(keys, open)` states the intent instead. It only writes keys — it never forces a row's
`open` past them — so an individual row still closes on its own click while the table stays
expanded.

**The keys moved into `stats.ts` and grew tests**, because this is the failure mode that leaves no
trace: a button writing `enc-7:Mirad` while the row reads `live-x:Mirad` throws nothing, logs
nothing, and simply does half its job. `rowKey`/`allRowsKey`/`foldKeys` are now one definition with
a test asserting the button's output is exactly the rows' input.

## Post-v1 — Code and performance audit: the backfill read the whole log at once  ✅
Measured first, as the last two audits concluded to. This time the measurement found something.

**The tailer allocated one buffer the size of the whole file.** `readNew` reads "the new bytes
since the last offset", which on a backfill is the entire 171MB log: one `Buffer.alloc(fileSize)`,
one `toString`, one `split` into 2.2M strings, then 2.2M synchronous handler calls. Three costs,
all measured on the real log, all fixed by reading in 1MB chunks:

| | whole-file | 1MB chunks |
|---|---|---|
| first response on the port | **13.1s** | **0.13s** |
| peak RSS during backfill | **1207MB** | **580MB** |
| resident engine heap afterwards | **400MB** | **206MB** |

The first is the one a user feels: the event loop never yielded, so the app served *nothing* for
13 seconds — and `start.command` waits on `/api/config` before opening the browser, so the wait was
staring right at it.

**The third was the surprise, and is invisible in the code.** A substring in V8 is a slice holding
a reference to its parent, and the engine keeps names out of the lines it is handed. One retained
ability name pins the entire string it was cut from — so decoding the log in one piece kept all
171MB alive for the rest of the session, long after the backfill. Chunking bounds any such slice
to 1MB. Halving the resident footprint of a process that runs all evening beside the game was not
what the change set out to do.

Verified line-for-line rather than by eye: replayed against the live log frozen at 180,300,749
bytes, the chunked tailer emitted **all 2,182,907 lines identically and in order** (it also picked
up 710 more — the file grew 61KB mid-run, which is the point of a tailer). Three tests cover what
chunking newly makes possible to get wrong: a multi-chunk backfill, a line longer than a chunk, and
a multi-byte character split across the seam. That last one fails against a plain `toString`, which
is how it earned its place — decoding now goes through `StringDecoder`, deleting the "log is ASCII"
assumption instead of restating it.

**What the code half found**, in the shape both previous audits predicted:
- **A rule stated twice.** The encounter ranking — damage share, DPS as tiebreak — was implemented
  in the engine *and* re-implemented in `foldEncounterCards` three commits ago, to re-seat my row
  in the lead. Now both halves of the fold are `filter`s over the order the engine sent, so the
  received ranking is the only thing deciding row order. Nothing would have *failed* had the two
  drifted; the rows would just have sat in an order the percentages contradicted. A test pins it.
- **An export nothing reads:** `Entity` in `src/types.ts`, referenced nowhere — not even in its own
  file. The fourth of these. `noUnusedLocals` still cannot see them (`export` counts as a use), so
  the scan stays a by-hand pass; separating *values* from *types* is what makes it quick, since an
  exported interface used only as its own module's parameter type is API surface, not dead weight.
- **A rationale duplicated six times, with its figures drifting apart in each.** "Four crit windows
  is 72KB against a 92KB snapshot" appeared in `app.ts`, `server.ts`, both `types.ts`, `crits.tsx`
  and the docs — and two copies had already diverged (90KB vs 92KB). Re-measured: **54KB against
  75KB**. The conclusion still holds, so the copies now state the reason and the numbers live in
  one place.

**Measurements taken and not acted on**, so the next pass doesn't re-derive them: `snapshot()` costs
0.07ms idle and 1.58ms mid-fight, and serialising it 0.16ms/1.74ms, against a ~5/sec push — under 2%
of a core. Replay of the full log is 12.6s for 1.5M events (119k events/sec). The crit ledger is
333,145 entries and 33MB, as recorded when it was built. Sending every encounter contributor instead
of the top six costs **4.5KB** on a 75KB snapshot.

## Post-v1 — A pet is its own fighter, not part of its owner's damage  ✅
A summoned pet's damage was folded into its owner's row — in the encounter tables and in the
History tab's character cards. That made the owner's dps **a figure no log line supports**, and it
had already broken the panel's internal agreement: the sparkline beside each encounter table is
built from `selfHits`, which is my own swings, so my bar and my row disagreed by exactly the pet's
output. The crit tracker had *always* excluded pet swings — "its crits, not mine" — so the fold was
the odd rule out, not the consistent one.

**The size of it, from the real log.** In a bandit pull the pet dealt **117 of the 175 damage —
66.9%** — and the old row presented all 175 as mine. Its tanking went the same way: 134 points the
pet absorbed, credited to me. Both figures now sit on the pet's own row, checked line-for-line
against the raw log inside that fight's window: Sanluen 58 engine / 58 raw, Jonantik 117 / 117.
(The first pass read 117 against 93 — the *grep* was wrong, missing the pet's typed-damage form
`for 6 points of cold damage by Water Elemental Attack`. Worth recording: the independent check is
only independent if it covers every line shape.)

**A pet has its own window, too.** It is summoned into fights already in progress and dies
mid-fight, so dividing its damage by its owner's engaged time was a third thing the fold got wrong.
Same pull: the pet engaged for 42s of my 45s, and its dps now divides by its own.

**Summoned and charmed stay distinguishable** — `petKind`, drawn as 🐾 and ⛓ in the same slot at the
same weight, since they answer one question ("why is this on our side?") with different answers. A
charm is temporary, breakable and frequently not even ours; a summon is not. Both carry the owner's
name as a tag, so whose pet it is stays readable without the damage moving.

Another player's pet already had its own row — `petOwners` is fed by `Master` lines and those name
only your own pet — so this makes your pet behave like everyone else's, rather than inventing a new
rule. `mergeStat` and `mergeAcc`'s paw-tagging went with the fold: a pet's abilities belong on the
pet's row, where they need no `🐾` prefix to say whose they are.

## Post-v1 — A pet's window closes when the pet does  ✅
Giving pets their own row left their rates dividing by the encounter's length, which for a pet is
the wrong denominator: it is the one participant whose *leaving* the log actually shows. Everyone
else is still standing there at the kill; a pet is summoned into a fight and dies inside it. So a
pet's window now runs **first contact to last contact with that mob** (`FightState.pairLast`),
never past the encounter's end.

**It is not a small correction.** Over the stretch of the real log where a pet was out, **9 of 13
pet rows read differently** than they would over the whole encounter. The extreme: a pet summoned
**18 seconds into a 24-second fight**, fighting for five of them — **6 dps on its own clock against
1** over the encounter. Both ends of two such windows were checked line-by-line against the raw
contact lines and matched exactly.

**Re-summons and re-charms are one instance, not one life each.** A row per instance would split a
pet's fight into slivers too short for any of their rates to mean anything, so one row spans first
to last with whatever gaps in between. The other half of that lives in `resetNpcTracking`, which
now prunes contact times the way it already pruned damage: what *reached* the mob resets — a
respawn wearing the name is a fresh instance — but what it **dealt to another mob** survives,
because that is pet damage banked in a still-running encounter. Without it a pet re-charmed
mid-fight restarted its window and read as seconds old.

**A caution worth recording: the first version of that test passed against both the old and new
code**, because the charm-break line it fed (`Your charm spell has worn off.`) does not parse —
the real form names the spell and the mob (`Your <spell> spell has worn off of <mob>.`). A test
that never reaches the branch it is guarding is worse than no test. Both new rules were then
checked by reverting the fix and confirming the test fails: 32 against 2.

`EncounterCard.startedSec` came with it, so a row can say *which* end it is short at — a pet that
died at the halfway mark and a player who arrived at the halfway mark are otherwise the same
`activeSec`, and the `time` tooltip called both "joined late".

**Players and the self keep the old rule** — window to the encounter's end — deliberately. Their
absence is not something the log states: a groupmate who stops swinging is still there, and
guessing otherwise would move every rate in the app on no evidence.

## Post-v1 — The Efreeti cycle is a place, not a missing island  ✅
Three corrections to the Sky tracker, all of them the panel describing the wiki's table instead of
the zone:

**"No island listed" → "Efreeti Cycle".** An untagged item is not a gap in the data — those items
are not *on* an island. The old label named the absence of a wiki tag; the new one names where you
go. It still sorts last, and `IslandNeeds.island` drops to a plain `string`: the null was only ever
standing in for this name.

**One heading for the cycle** (`Dojorn / Overseer / Hand`) instead of one per mob. Grouping by
first-named source is right on an island, where which boss to kill is a choice — but the cycle is
not a choice, and the wiki gives nearly every Efreeti item a different overlapping subset of the
same three names, so the rule split one thing you do into four headings. Rows the wiki sources
elsewhere or not at all (`Efreeti Statuette`, `Brass Knuckles`) sit under it too; each row's
tooltip still names its own sources, so the shared heading hides nothing.

**`Gem of Invigoration` moves to "no mob listed"** — the wiki credits the Protector of Sky, which
does not drop it. This one is a *data* fix, and the catalogue is generated, so it went into the
generator as `DROPS_FROM_OVERRIDES` rather than into the file it produces: a hand-edit would have
vanished at the next re-run and looked freshly generated while doing it. The override table throws
if it names an item the wiki no longer sources, so a stale correction fails loudly instead of
sitting there, and a test asserts the correction is actually present in the shipped catalogue.

Regenerating produced exactly that one line plus the date stamp — no wiki drift since 2026-08-02.

## Post-v1 — A second source for where things drop  ✅
The wiki's loot table is the weakest part of the catalogue: it left **25 of the 113 components with
no mob at all**, so a quarter of the panel's rows sat under a "no mob listed" heading meaning *we
don't know*. eqlposky.com's `data.js` states one source per item as `Island <n>: <mob>`. The
generator now reads both. **Every component names a mob; the "no mob listed" heading is gone.**

Every one of our 113 components is on their page — 0 unmatched either way, which is the check that
made the merge trustworthy rather than hopeful.

**Union, wiki first: the second source fills gaps and adds names, never removes one.** The wiki is
often the *more* specific of the two (`Bazzzazzt, Bizazzzt, Bzzzt` against `"bee" mobs`), so a rule
that preferred the newer source would have thrown that away. Collectives like
`drake/sphinx/spirit mobs` are taken only when nothing else is known — beside three named mobs they
repeat the same thing, vaguely.

**Read by regex, never evaluated.** It is a remote script; a build step that runs one is a
supply-chain hole for a table of mob names.

**Four bugs the diff caught, each found by looking at the output rather than trusting the rule:**
- A double-quote-only pattern silently skipped every entry written with single quotes — which is
  how one with a nickname inside is written (`'Island 6: Bazzt Zzzt "Bees"'`). One item lost.
- Matching on the raw name missed `Crown Of Elemental Mastery` against their `Crown of Elemental
  Mastery`; the two sites disagree on capitalisation exactly as the game does, so it now folds on
  the same key `sky.ts` uses at runtime.
- Islands were looked up in the wiki's shorthand map with eqlposky's *numbers*, so every island fill
  silently resolved to nothing. `Efreeti Statuette` stayed in the Efreeti cycle it never belonged
  to; it is Island 4, essence mobs.
- Once the fold worked, `Crown Of Elemental Mastery` picked up the wiki's `Various` — which sorts
  first in a comma list and became the **group heading**. `Various` and `None?` are the wiki
  declining to answer, and are now discarded at the source.

**An island is adopted only when every mob it names is on one.** Several islands means the Efreeti
cycle, which is precisely the case the wiki tags with no island — so the cycle survives as its own
category instead of being overwritten by whichever number came first. Their data independently
confirms it: `Island 1.5: Noble Dojorn / Island 4: Overseer of Air / Island 8: the Hand of Veeshan`
is the same three mobs the panel already grouped under one heading.

**Discrepancies worth naming.** Both sources list the Efreeti cycle for `Efreeti Great Staff`; the
player says it comes off the **Eye of Veeshan** and not the cycle, so an override replaces it and
moves it to Island 8. And eqlposky sources `Gem of Invigoration` to **a greater sphinx** — which
contradicts the previous session's instruction to leave it with no mob listed, though it agrees
with the item's own `7-Trash` island tag, and is the more useful answer than a blank.

**And one the log settles outright: `Efreeti Statuette` is an Efreeti-cycle drop.** Both sources
file it with Island 4's essence mobs, having inherited the same mistake from an older game — which
is worth knowing about them as sources, since agreement between two sites is not independence when
one copied the other's ancestor. The log names all three cycle mobs and no essence mob at all:

    Aug 03 23:45  You looted an Efreeti Statuette from Noble Dojorn's corpse …
    Aug 07 00:08  … from the Hand of Veeshan's corpse …
    Aug 07 01:49  … from Overseer of Air's corpse …
    Aug 07 02:10  … from the Hand of Veeshan's corpse …

Four pickups across all three, none from an essence harvester or tamer in 2.4M lines — the exact
signature every other Efreeti item has. The override carries those lines in a comment, because the
next person to read it will otherwise see a correction contradicting both public sources with
nothing to justify it. **`island: null` is the load-bearing half**: the override check had to
become "is the key present" rather than "is the value truthy", or "belongs to no island" fell
through to the island the second source infers from the mob, and the row left the cycle again.

## Open questions to revisit
- **Trash grouping** — per-pull (default) vs. per-mob rows; per-mob always visible in drill-down.
- **Whose damage** — v1 parses everyone the log witnesses (group/raid for free); confirm vs. self-only.
- **Multiple logs** — the picker handles this; default selection is the newest file.
