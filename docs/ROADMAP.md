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

## Open questions to revisit
- **Trash grouping** — per-pull (default) vs. per-mob rows; per-mob always visible in drill-down.
- **Whose damage** — v1 parses everyone the log witnesses (group/raid for free); confirm vs. self-only.
- **Multiple logs** — the picker handles this; default selection is the newest file.
