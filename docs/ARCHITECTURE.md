# Architecture

## One-paragraph overview

A small **local backend** (Node.js + TypeScript) tails the character log natively, parses each line
into a combat event, runs a **fight-segmentation + aggregation engine** in memory, and pushes state
to a **browser SPA**. The browser loads static UI over HTTP, receives live updates via **Server-Sent
Events (SSE)**, and sends control actions (pick log, set filters) via plain HTTP. Everything runs on
`localhost`; nothing leaves the machine.

```
 EverQuest Legends (Wine)
        │ appends
        ▼
 eqlog_<Char>_<server>.txt ──watch/tail──► Backend (Node.js / TypeScript)
                                             ├─ Tailer      (byte-offset reader, CRLF-safe)
                                             ├─ Parser      (line → CombatEvent, incl. stances)
                                             ├─ Engine      (fights, entities, stances, aggregation)
                                             └─ Server      (HTTP static + JSON API + SSE stream)
                                                     │ SSE (server→UI)   HTTP (UI→server control)
                                                     ▼
                                             Browser SPA
                                             ├─ Log picker      (choose which log to parse)
                                             ├─ Live pane       (current fight + filters)
                                             └─ History pane    (past fights + drill-down)
```

## Why Node + SSE (not Bun + WebSocket)

- **Node 22 is already installed** on the target machine; Bun is not. Building on Node means zero new
  tooling to start. The codebase is standard TypeScript, so moving to Bun later (for its single-binary
  `--compile`) is a drop-in change if we want it at packaging time.
- **SSE** fits this app: updates are overwhelmingly **server→client** streaming, which SSE does with a
  built-in browser auto-reconnect and **no runtime dependency** (raw `node:http`). The few client→server
  actions (select log, change filters) are ordinary HTTP requests. This keeps the dependency count ~0.

## Backend components

### Tailer
- Opens the log and tracks a **byte offset**; on each change reads only new bytes.
- **CRLF-safe & partial-line-safe**: buffer trailing bytes until `\n`; strip `\r`.
- Change detection: `fs.watch`/FSEvents **plus a stat-based polling fallback** (~500ms).
- **Rotation/reset handling**: if size < last offset or inode changes, reset (truncation, `/log` toggle, new session).
- Modes: **live** (start at EOF, follow) and **backfill** (parse whole file, then follow).
- **Switchable at runtime**: the active log is chosen by the UI; the tailer can stop and re-open on a new path without restarting the process.

### Parser
- Pure function `parseLine(raw) → CombatEvent | null`.
- **Keyword prefilter** before regex (skip lines lacking `damage`/`slain`/`but miss`/`assume`/…).
- Event types: `MeleeDamage`, `SpellDamage`, `DotTick`, `Miss`, `Death`, **`Stance`**, `Heal`, `Pet`, `Zone`, **`Progress`**. Grammar in [`LOG_FORMAT.md`](LOG_FORMAT.md).
- **`Progress`** covers self progression — level-ups, ability points, AAs bought/ranked, skill
  unlocks, skill-ups and xp ticks. These are orders of magnitude rarer than damage lines, so they
  are tried **last**, behind a single `^You (have )?(gain|become|improved)` prefix test: the hot
  path never pays for them.
- Deterministic, side-effect-free → unit-testable against fixture lines.

### Engine
- **Entity roster** — players, pets, and **NPCs are all first-class**; each can be inspected for outgoing damage.
- **Stance timeline** — updated on every `Stance` event; each self damage event is tagged with the stance active at its timestamp (self only; other players' stances aren't in the log).
- **Fight segmentation** (configurable): opens on first player→NPC damage after idle; closes when all engaged NPCs are slain, on **zoning** (`You have entered <zone>.` — you leave all mobs behind), **or** after `inactivityTimeout` s (default **90s**, wall-clock — a 3s tick closes abandoned fights with no new log lines). Named NPCs get friendly titles; trash groups by the active NPC set.
- **Encounter liveness**: a per-NPC pane is *active* only while the NPC is un-slain, its owner is alive (enemy pets named `<owner> pet` despawn when the owner dies), and it has seen activity within the inactivity window (~90s).
- **Encounters** (the primary view): each mob is a per-character table (one row per player/pet, a %-of-damage bar + DPS/HPS/tank columns, expandable to abilities). `snapshot()` exposes **`activeEncounters`** (mobs currently being fought — live tables at the top) and **`recentEncounters`** (a rolling last-5, newest first). A mob is finalized on death **or on fight close** (zone / 90s / abandon) for a boss you fled. On death the mob's per-encounter tracking is **reset**, so a same-named respawn (`a clay gargoyle`) is a fresh instance rather than merging into one inflated span; fled/closed mobs cap their end to their last combat activity. **Rates are per-person**: each character's active window starts at *their* first contact with the mob (their attack, or the mob first hitting/casting on them — tracked as per-`attacker>target` first-contact timestamps) and runs to the encounter end, so late-joiners aren't diluted. Per-(target, attacker) damage is kept as full metric accumulators.
- **Stance overview rows** carry both sides of a combo: `damage`/`dps` from `selfComboLog` (self **outgoing**, tagged with the combo live at each event) and `taken`/`takenPerSec` from `selfTakenComboLog` (its mirror, recorded when I am the *target* and the attacker isn't me — so self-damage never lands in the taken column). `timeShare` is the combo's share of the window's total combat seconds. Both logs share the same merged-window math and are trimmed together as encounters age out. Rates are whole numbers, so a trickle of incoming damage rounds to `0`/sec while the total still records it — the UI shows `<1` for that case.
- **Self encounter history**: `snapshot().encounterHistory` is the last **50** finished encounters seen from my side — my DPS, my total damage, damage I took, its start/end and duration, and the **dominant stance combo** (the combo I spent the most seconds in over the encounter's window, via `dominantComboIn` → `comboSecondsIn`). Cached next to `overviewCache` and invalidated on the same event (a new finished encounter). This is what the overview's history chart plots; `recentEncounters` stays at 5 because it carries full per-combatant tables.
- **Progression** splits by frequency, because the two halves are used differently:
  - **`milestones`** — the rare, *markable* kinds only (`level`, `ap`, `ability`, `death`, `zone`),
    chronological, each with a short label and a full-sentence `detail`. These become glyphs on the
    chart's timeline, so the list stays small enough to ship in every SSE snapshot.
  - **`progressLog`** — skill-ups and xp ticks. There are thousands of them in a session (~5k skill-ups
    in a 460k-line log), so they are never marked; they only feed counters.
  - Both are trimmed with the combo logs when an encounter ages out, and `progressWindows` reduces
    them to per-window totals over the same 10/25/50 slices the stance overview uses — cached and
    invalidated on the same events. `progress` carries the latest level + unspent AP.
  - A `Progress` event never opens, extends, or closes a fight; it only annotates the timeline.
    A level-up fires immediately after a kill, so it lands on the boundary *between* two encounters.
- **A friendly death ends nothing.** Only an NPC's death finalizes an encounter and resets its
  tracking; doing that for a player would erase the corpse's damage from every mob still being
  fought — which is precisely the run you want to keep looking at.
- **Aggregation** per fight → per combatant:
  - totals, DPS (damage ÷ active-seconds), % of fight, hit/crit/miss counts;
  - **damage-by-type** (melee / spell / DoT) for drill-down;
  - **per-ability breakdown** (verb for melee, real spell name from DoT/spell lines);
  - **damage-by-stance** and a per-fight stance split (self).
- Separated from I/O so a whole file can be replayed for tests/backfill.

### Server
- Serves the built SPA statically (embedded in the binary at packaging time).
- **Cache headers matter here.** Vite fingerprints every bundle, so `assets/*` is served
  `public, max-age=31536000, immutable`, while `index.html` (and anything else unfingerprinted) is
  `no-store`. Without that split a browser caches the HTML heuristically, and the next rebuild leaves
  it requesting a bundle hash that no longer exists — a 404 that presents as a *blank page* (the old
  CSS is still cached and paints the background, so it reads as a broken render, not a missing file).
  A hard reload fixes it for one person; the headers fix it for everyone, including packaged builds.
- JSON API (draft):
  - `GET  /api/logs` → current folder + its `eqlog_*.txt` (path, character, server, size, mtime), newest first.
  - `POST /api/log-dir` `{ dir }` → change the scanned logs folder (validated), re-list, auto-select newest.
  - `POST /api/logs/active` `{ path, mode }` → switch the actively parsed log (live | backfill).
  - `GET  /api/fights` → fight summaries (history).
  - `GET  /api/fights/:id` → full combatant + ability + stance detail for one fight.
  - `GET  /api/config` / `POST /api/config` → inactivityTimeout, etc.
- `GET /events` → **SSE** stream of `snapshot`, `fightStarted`, `fightUpdate`, `fightEnded`, `stanceChanged`, `entityUpdate`. The `snapshot` payload carries `milestones`, `progressWindows` and `progress` alongside the combat state; the UI reads all three defensively so an older backend still renders.
- Binds to `127.0.0.1` only.

## Streaming protocol (draft)

```ts
// SSE events (server → browser); each SSE `data:` is one JSON object
type ServerEvent =
  | { t: "snapshot";      activeLog: string | null; current: Fight | null; recent: FightSummary[]; stance: string }
  | { t: "fightStarted";  fight: FightSummary }
  | { t: "fightUpdate";   fightId: string; combatants: CombatantStats[]; durationSec: number }
  | { t: "fightEnded";    fight: FightSummary }
  | { t: "stanceChanged"; stance: string; sinceMs: number };

interface CombatantStats {          // one meter row
  name: string; kind: "self"|"player"|"pet"|"npc"|"unknown"; isSelf: boolean;
  total: number; dps: number; pct: number;
  hits: number; crits: number; misses: number;
  byType: { melee: number; spell: number; dot: number };   // drill-down
  abilities: { name: string; damageType: "melee"|"spell"|"dot"; total: number; hits: number; crits: number }[];
  stances?: { stance: string; total: number; dps: number }[];   // self only
}
```

## Frontend

- **React + Vite**, plain CSS. A DPS meter is sorted horizontal bars — no chart lib needed for v1.
- **Log picker** — dropdown of detected logs (from `/api/logs`) to choose which one is parsed live; remembers last choice.
- **Live pane** — current fight, auto-updating, with **filters**: by combatant kind (players / NPCs / pets), by damage type (melee / spell / DoT), and by stance. A live stance indicator shows the active stance.
- **History pane** — fight list; select a fight to **drill down**: per-combatant rows → expand to damage-type split, per-ability breakdown, and (for self) the stance split active during that fight.
- **Your own row is always expanded** in every encounter table — the damage breakdown line (total, melee/spell/DoT split, crits) and top ability chips render without a click, marked with a blue left rule. Everyone else toggles on click.
- **Number formatting** (`components.tsx`, one `scaleK(n, at)` helper): k-notation past a per-context threshold, one decimal, dropped to zero decimals past 100k so the narrow columns don't overflow. Thresholds — **10k** for the dps/hps columns, **2k** for the tank column (tanking totals climb fastest), **1k** inside the encounter drill-down lines.
- **My DPS panel** — stance-combo cards (avg DPS per melee+invocation over the window) plus an **encounter history chart** below them, both driven by the same 10/25/50 window chip.
  - Each card carries the combo's **defensive cost and usage** under its DPS — `🛡 <taken>/s · ⏱ <share>%` — so a combo that out-damages the rest on 5% of your time reads as the thin sample it is. The full sentence (including the raw seconds behind the share) is in the card's `title`.
  - The header prints **current vs. best**: the combo you're standing in right now against the window's top combo (`current combo −11% vs best (2,400 dps)`), or `best of N` when they're the same. It wraps to its own line in a narrow side panel.
  - **Diverging bars**: my DPS above the baseline, total damage taken below. The halves are *mirrored panels over a shared encounter axis*, **not one scale** — each is normalised to its own peak and both peaks are printed in the header (`▲ peak … dps · ▼ peak … taken`), so bar heights are never compared across the baseline. (Plotting a rate and a total on one shared axis would be a dual-axis chart, which invents a correlation that isn't in the data.)
  - **Colour = stance combo**, shared between a card's swatch and its bars. Slots are handed out in the order combos **first appear in the full 50-encounter history**, never by DPS rank — so changing the window or a combo's ranking never repaints an existing bar. Six categorical slots (`--s1`…`--s6`); a seventh combo falls through to the neutral `--s-other`.
  - The six slots are the dark steps of the reference categorical palette, validated against the panel surface `#1c2029` (lightness band, chroma floor, adjacent-pair CVD separation, normal-vision floor, ≥3:1 contrast all pass). Because bar order is chronological, arbitrary combo pairs *can* end up adjacent, and the full six do not clear the stricter all-pairs CVD floor — so identity is never colour-alone: hovering any bar names the encounter and its combo in the header readout, and clicking a card highlights just that combo's bars.
  - Bars cap at 14px wide and stay centred in their slot, so a 10-encounter window reads as a time series rather than a row of blocks. A vertical gradient and rounded caps give them depth; the encounter that set each half's peak carries a hairline outline, so the header's peak figure has a visible owner.
  - A dashed **average line** crosses the DPS half at the window's avg dps — the *same figure the panel header prints*, not a second average computed a different way, so "above the line" means exactly what the header says.
  - **Milestone rail.** The baseline between the halves is the timeline: level-ups (▲), ability points (◆), AAs and skill unlocks (★), my deaths (✕) and zone changes (»). Each mark sits on the **left edge of the encounter it belongs to** — the first encounter that ended at or after it — so a level-up earned on a kill lands exactly on the boundary between the two bars. Several in one gap (ding → ability point → new AA) cluster; past three they collapse to `+N`. Levels and deaths also draw a full-height guide, because those two are what explain a step change in the bars.
  - Marks are identified by **shape**, not colour — the rail is far too small for colour to carry identity — and hovering any of them replaces the header readout with its full sentence and clock time.
  - Below the chart, a **progression strip** shows current level and unspent AP, then what the window bought: levels, AP, abilities, deaths (in the rail's own glyphs, so the strip doubles as its legend), and — deliberately glyph-less, since they are counted but never marked — skill-ups and summed xp percent.
- **Visual hierarchy** — panels sit on a raised surface above a darker page (`--panel` vs `--bg`, plus a drop shadow). **Active encounters are deliberately loud**: warm gradient, heavier frame, a `--live` accent stripe down the left edge, an accented section header, and a pulsing `⚔` dot (suppressed under `prefers-reduced-motion`). Finished encounters stay neutral so a long recent list doesn't turn into competing accents.
- Reconnects to SSE automatically; renders from the last snapshot on load.

## Tech stack & packaging

- **Language/runtime:** TypeScript on **Node.js 22** (already installed). Dev via `tsx`; tests via `node --test`.
- **Runtime dependencies:** aim for none in the backend (built-in `node:http`, `node:fs`); React/Vite are frontend build-time only.
- **Distribution (M5):** **Node SEA** (single-executable app) bundling the built SPA → one file to double-click. If cross-compiling to Windows proves cleaner via Bun's `--compile`, we can switch the packaging step without touching app code.
- **Config:** JSON/`.env` for `logDir`, `port`, `inactivityTimeout`; auto-detects the newest `eqlog_*.txt`. Env override `EQL_LOG_DIR`.

## Platform independence

Only the **default log directory** is OS-specific (per-OS lookup table: macOS Wine bottle / Windows `.../Logs` / Linux Wine prefix). The tailer, parser, engine, server, and UI are all OS-agnostic — the "runs on a PC too" goal is essentially free.
