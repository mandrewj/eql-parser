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
  the same 10/25/50 slices) and `progress` (level + unspent AP). Progression never opens or closes
  a fight.
- The history chart gains a **milestone rail** on its baseline — ▲ level, ◆ ability point,
  ★ ability, ✕ death, » zone — placed on the encounter boundary each event landed on, with
  full-height guides for levels and deaths. Identity is shape, not colour; hover names the event.
- Chart polish: gradient bars with rounded caps, an outline on the encounter that set each peak,
  a dashed average line matching the header's figure, and a header that reports the window's span.
- A **progression strip** under the chart reports current level / unspent AP and what the window
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

## Backlog (engine already supports the shape)
- Real spell-name mapping for non-melee "effect" messages via a damage-message table (from EQLogParser).
- Fight export/share (JSON/image) and run-over-run comparison. Needs the first **persistence** in the
  app: today the log file *is* the store and backfill re-derives everything in ~25s, so this only earns
  its keep across log rotations.
- Optional true always-on-top overlay (revisit Tauri/Electron only if the browser window proves insufficient).

### Weighed on 2026-07-29 and not taken (yet)
Kept here so the reasoning isn't re-derived. Ranked by value-per-effort as judged then:
- **"What killed me"** — deaths are already milestones and the last hits before one are in `perTarget`;
  a survivability drill-down needs no new parsing. The strongest of these.
- **Ability-level efficiency over the window** — crit and miss rates per ability across the last N
  encounters rather than one fight, turning the drill-down into "your crush crits 12%, your smite 4%".
- **Prescriptive stance cards** — the tiles report each combo's DPS and defensive cost but never say
  *switch*; `seconds` per combo is already the confidence needed to suppress a thin-sample suggestion.
- **A second line on the history chart** at the panel header's combat-clock figure, so the gap between
  the two averages is visible on the chart instead of explained in a tooltip.
- **`scaleK` past 100k** prints `1284k` rather than `1.28M` — visible on long boss fights and tank
  totals. One line, whenever it next annoys.
- ~~**`.erow.pet` / `.erow.npc` fills are unreachable**~~ — `.erow.pet` is now the charmed-pet row,
  which is exactly the "mob as a row" this entry was holding the styling for. `.erow.npc` is still
  unreachable and still deliberate.

## Open questions to revisit
- **Trash grouping** — per-pull (default) vs. per-mob rows; per-mob always visible in drill-down.
- **Whose damage** — v1 parses everyone the log witnesses (group/raid for free); confirm vs. self-only.
- **Multiple logs** — the picker handles this; default selection is the newest file.
