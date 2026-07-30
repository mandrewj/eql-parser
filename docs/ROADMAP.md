# Roadmap

Milestones are ordered so each is runnable and verifiable on its own. Earlier milestones need no UI,
so we prove the parser/engine are correct against the real log before building anything visual.

**Runtime:** TypeScript on **Node.js 22** (already installed). Dev via `tsx`, tests via `node --test`,
live updates via **SSE**. Single-binary packaging deferred to M5 (Node SEA).

**Progress:** M0–M5 complete — v1 shipped. Parser, engine, live tailer/SSE, React UI, and a
single self-contained bundle (`dist/eql-parser.cjs`) plus an optional native SEA binary.

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

## Backlog (engine already supports the shape)
- Real spell-name mapping for non-melee "effect" messages via a damage-message table (from EQLogParser).
- Fight export/share (JSON/image) and run-over-run comparison.
- Optional true always-on-top overlay (revisit Tauri/Electron only if the browser window proves insufficient).

## Open questions to revisit
- **Trash grouping** — per-pull (default) vs. per-mob rows; per-mob always visible in drill-down.
- **Whose damage** — v1 parses everyone the log witnesses (group/raid for free); confirm vs. self-only.
- **Multiple logs** — the picker handles this; default selection is the newest file.
