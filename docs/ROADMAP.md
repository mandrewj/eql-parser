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

## Post-v1 — Healing & tanking  ✅
- `HealEvent` parsing (effective/overheal, reflexive targets, `by <Spell>`); group heals visible.
- Engine gives each combatant three metric groups — damage done, healing done, damage taken —
  each with total + per-category breakdown; heals also inform friend/foe classification.
- Melee verbs normalized to base form so `kick`/`kicks` merge into one category.
- UI: Damage/Healing/Tanking selector; drill-down is a table (total + top ~10 categories).

## Backlog (engine already supports the shape)
- Real spell-name mapping for non-melee "effect" messages via a damage-message table (from EQLogParser).
- Pet-damage attribution to owners.
- Fight export/share (JSON/image) and run-over-run comparison.
- Optional true always-on-top overlay (revisit Tauri/Electron only if the browser window proves insufficient).

## Open questions to revisit
- **Trash grouping** — per-pull (default) vs. per-mob rows; per-mob always visible in drill-down.
- **Whose damage** — v1 parses everyone the log witnesses (group/raid for free); confirm vs. self-only.
- **Multiple logs** — the picker handles this; default selection is the newest file.
