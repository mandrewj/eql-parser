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
- Event types: `MeleeDamage`, `SpellDamage`, `DotTick`, `Miss`, `Death`, **`Stance`**. Grammar in [`LOG_FORMAT.md`](LOG_FORMAT.md).
- Deterministic, side-effect-free → unit-testable against fixture lines.

### Engine
- **Entity roster** — players, pets, and **NPCs are all first-class**; each can be inspected for outgoing damage.
- **Stance timeline** — updated on every `Stance` event; each self damage event is tagged with the stance active at its timestamp (self only; other players' stances aren't in the log).
- **Fight segmentation** (configurable): opens on first player→NPC damage after idle; closes when all engaged NPCs are slain, on **zoning** (`You have entered <zone>.` — you leave all mobs behind), **or** after `inactivityTimeout` s (default **90s**, wall-clock — a 3s tick closes abandoned fights with no new log lines). Named NPCs get friendly titles; trash groups by the active NPC set.
- **Encounter liveness**: a per-NPC pane is *active* only while the NPC is un-slain, its owner is alive (enemy pets named `<owner> pet` despawn when the owner dies), and it has seen activity within the inactivity window (~90s).
- **Encounters** (the primary view): each mob is a per-character table (one row per player/pet, a %-of-damage bar + DPS/HPS/tank columns, expandable to abilities). `snapshot()` exposes **`activeEncounters`** (mobs currently being fought — live tables at the top) and **`recentEncounters`** (a rolling last-5, newest first). A mob is finalized on death **or on fight close** (zone / 90s / abandon) for a boss you fled. On death the mob's per-encounter tracking is **reset**, so a same-named respawn (`a clay gargoyle`) is a fresh instance rather than merging into one inflated span; fled/closed mobs cap their end to their last combat activity. **Rates are per-person**: each character's active window starts at *their* first contact with the mob (their attack, or the mob first hitting/casting on them — tracked as per-`attacker>target` first-contact timestamps) and runs to the encounter end, so late-joiners aren't diluted. Per-(target, attacker) damage is kept as full metric accumulators.
- **Aggregation** per fight → per combatant:
  - totals, DPS (damage ÷ active-seconds), % of fight, hit/crit/miss counts;
  - **damage-by-type** (melee / spell / DoT) for drill-down;
  - **per-ability breakdown** (verb for melee, real spell name from DoT/spell lines);
  - **damage-by-stance** and a per-fight stance split (self).
- Separated from I/O so a whole file can be replayed for tests/backfill.

### Server
- Serves the built SPA statically (embedded in the binary at packaging time).
- JSON API (draft):
  - `GET  /api/logs` → current folder + its `eqlog_*.txt` (path, character, server, size, mtime), newest first.
  - `POST /api/log-dir` `{ dir }` → change the scanned logs folder (validated), re-list, auto-select newest.
  - `POST /api/logs/active` `{ path, mode }` → switch the actively parsed log (live | backfill).
  - `GET  /api/fights` → fight summaries (history).
  - `GET  /api/fights/:id` → full combatant + ability + stance detail for one fight.
  - `GET  /api/config` / `POST /api/config` → inactivityTimeout, etc.
- `GET /events` → **SSE** stream of `snapshot`, `fightStarted`, `fightUpdate`, `fightEnded`, `stanceChanged`, `entityUpdate`.
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
- **Visual hierarchy** — panels sit on a raised surface above a darker page (`--panel` vs `--bg`, plus a drop shadow). **Active encounters are deliberately loud**: warm gradient, heavier frame, a `--live` accent stripe down the left edge, an accented section header, and a pulsing `⚔` dot (suppressed under `prefers-reduced-motion`). Finished encounters stay neutral so a long recent list doesn't turn into competing accents.
- Reconnects to SSE automatically; renders from the last snapshot on load.

## Tech stack & packaging

- **Language/runtime:** TypeScript on **Node.js 22** (already installed). Dev via `tsx`; tests via `node --test`.
- **Runtime dependencies:** aim for none in the backend (built-in `node:http`, `node:fs`); React/Vite are frontend build-time only.
- **Distribution (M5):** **Node SEA** (single-executable app) bundling the built SPA → one file to double-click. If cross-compiling to Windows proves cleaner via Bun's `--compile`, we can switch the packaging step without touching app code.
- **Config:** JSON/`.env` for `logDir`, `port`, `inactivityTimeout`; auto-detects the newest `eqlog_*.txt`. Env override `EQL_LOG_DIR`.

## Platform independence

Only the **default log directory** is OS-specific (per-OS lookup table: macOS Wine bottle / Windows `.../Logs` / Linux Wine prefix). The tailer, parser, engine, server, and UI are all OS-agnostic — the "runs on a PC too" goal is essentially free.
