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
                                             ├─ Live pane       (my DPS + per-NPC encounters)
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
- Event types: `MeleeDamage`, `SpellDamage`, `DotTick`, `Miss`, `Death`, **`Stance`**, `Heal`, `Pet`, **`Charm`**, `Zone`, **`Progress`**. Grammar in [`LOG_FORMAT.md`](LOG_FORMAT.md).
- **`Charm`** carries one of three states — `cast` (someone began a charm spell; names the
  caster, not the target), `on` (a mob became charmed; names the target, never the caster)
  and `off` (a charm broke). The two halves never share a subject, so pairing them is the
  *engine's* job — the parser stays a pure function of one line. Charm lines are ~0.07% of a
  real log, so the whole block sits behind one token test and is tried after every damage
  pattern; it falls through to `Progress` rather than returning, since an AA can be named
  for a charm spell.
- **`Progress`** covers self progression — level-ups, ability points, AAs bought/ranked, skill
  unlocks, skill-ups and xp ticks. These are orders of magnitude rarer than damage lines, so they
  are tried **last**, behind a single `^You (have )?(gain|become|improved)` prefix test: the hot
  path never pays for them.
- Deterministic, side-effect-free → unit-testable against fixture lines.

### Engine
- **Entity roster** — players, pets, and **NPCs are all first-class**; each can be inspected for outgoing damage.
- **Charmed pets are a *window*, not a fact.** The same mob is an enemy before the charm, an
  ally during it, and an enemy again after it breaks, so the engine closes the books at each
  boundary instead of picking a side: on the charm it banks what the mob did and what was
  done to it as a finished encounter and wipes its tracking (the same reset a death does,
  for the same reason — one name, two separate lives), and on the break it wipes again so
  the next blow opens a fresh encounter. A charmed mob is dropped from `npcSeeds` and
  `aliveEngaged` so it can't hold a fight open past its kill, and a charm is cleared on the
  pet's death (or a name-shared respawn would inherit it) and on zoning.
  - **Ownership** is inferred by pairing an `on` with the most recent `cast` within **3s**;
    unpaired charms still get a row, just without a charmer. On the real log this named an
    owner for 160 of 174 pet rows.
  - **Breaks** that the log announces cover only your own charm, so two behavioural signals
    carry the rest: a pet turning on **its own charmer**, and blows traded with **me** in
    either direction (you cannot damage your own charmed pet, nor it you). Both wait out a
    3s grace window, because a swing already in the air when the charm lands still connects —
    a real pet glazed at 03:35:56 and struck a groupmate at 03:35:57, then fought for us for
    the next half minute. A **DoT tick never breaks a charm**: an AoE DoT cast before the
    charm keeps ticking for its full duration, and reading that as a break un-charmed a
    healthy pet a few seconds in. Real breaks always bring melee or a nuke with them.
- **Classification runs in two tiers**, because its rules are not equally trustworthy and
  every one of them guards on "not already classified" — so whichever fires first wins,
  which used to be an accident of log order. Pass 0 is the strong evidence (attacking or
  being attacked by a *known* mob, heals, kills, pet ownership); pass 1 is the softer
  inference from who swung at whom, in both directions (nothing damages a friendly except an
  enemy — this game has no friendly fire).
  - **A charmed mob is never a witness in pass 1, on either side.** Entities are keyed by
    name and a generic name is not unique, so a charmed `a wan ghoul knight` shares its key
    with the twin still fighting us — `A wan ghoul knight tries to slash a wan ghoul knight,
    but misses!` is one real line. Trusting it as an attacker brands whoever the *twin*
    mauls as a mob; trusting it as a target brands the groupmate hitting the twin. Both were
    observed on the real log putting a **player** in the encounter list, and excluding it in
    both directions is what removed them — including two (`Prisms`, `Rykkerr`) that the
    pre-charm code was already inventing.
  - The residual cost: a mob *only* ever touched by a charmed pet, that never hits anything
    back, stays unclassified and gets no encounter. On the whole log that was one mob, in
    which I dealt no damage.
- **Stance timeline** — updated on every `Stance` event; each self damage event is tagged with the stance active at its timestamp (self only; other players' stances aren't in the log).
- **Fight segmentation** (configurable): opens on first player→NPC damage after idle; closes when all engaged NPCs are slain, on **zoning** (`You have entered <zone>.` — you leave all mobs behind), **or** after `inactivityTimeout` s (default **90s**, wall-clock — a 3s tick closes abandoned fights with no new log lines). Named NPCs get friendly titles; trash groups by the active NPC set.
- **Encounter liveness**: a per-NPC pane is *active* only while the NPC is un-slain, its owner is alive (enemy pets named `<owner> pet` despawn when the owner dies), and it has seen activity within the inactivity window (~90s).
- **Encounters** (the primary view): each mob is a per-character table (one row per player/pet, a %-of-damage bar + DPS/HPS/tank columns, expandable to abilities). `snapshot()` exposes **`activeEncounters`** (mobs currently being fought — live tables at the top) and **`recentEncounters`** (a rolling last-5, newest first). A mob is finalized on death **or on fight close** (zone / 90s / abandon) for a boss you fled. On death the mob's per-encounter tracking is **reset**, so a same-named respawn (`a clay gargoyle`) is a fresh instance rather than merging into one inflated span; fled/closed mobs cap their end to their last combat activity. **Rates are per-person**: each character's active window starts at *their* first contact with the mob (their attack, or the mob first hitting/casting on them — tracked as per-`attacker>target` first-contact timestamps) and runs to the encounter end, so late-joiners aren't diluted. Per-(target, attacker) damage is kept as full metric accumulators.
- **Per-encounter sparkline.** `selfHits` keeps my damage to each target timestamped — which
  `selfComboLog` cannot answer, since it is per-*session*, not per-mob, and would blend two mobs fought
  at once into one strip that disagreed with the row above it. `encounterView` buckets it into
  `selfSpark`: a dps per bucket over the encounter's span, buckets never under a second (the log's own
  resolution) and never more than **40** of them, widening instead. Leading zeros are real information —
  they are the seconds the mob was up before I engaged, the same gap the row's `time` column reports as
  a number. Dropped with the mob's other tracking in `resetNpcTracking`, so a respawn starts empty.
- **Two whole-encounter figures sit alongside those per-person rows**, both over the encounter span (the mob's first interaction → its end, which *is* the mob's own active window, so the same denominator is honest for both): `total`/`dps` — what everyone dealt to the NPC, and `npcDamage` — what it dealt back, summed over every friendly it hit by scanning `perTarget` for the mob's own attacker cells. Those cells are cleared by `resetNpcTracking` along with everything else on death, so a same-named respawn's output starts at zero too. Only the **total** is folded (via `rateStat`, not `toStat`): the header prints a rate, and each victim's card already ships that same damage broken down under `taken`, so merging the mob's abilities again would put ~1.4KB of duplicate detail in every snapshot. The header prints both; the rows below stay per-person, which is exactly why the header labels itself.
- **The stance overview is the engine's most expensive rebuild**, and it happens on **every kill** — so
  it earns its algorithm. The merged encounter windows are sorted and disjoint and both combo logs are
  chronological (appended in event order, trimmed only from the front), so a single pointer walks a log
  against the windows instead of testing every entry against every window, and a bisect skips straight
  to the first entry inside the window — a 10-encounter window stops paying for a 50-encounter-deep log.
  Measured on the real 628k-line log: **758µs → 146µs**, which took a cold `snapshot()` from 854µs to
  174µs. Verified byte-identical to the naive scan over that whole log before landing.
- **Each window interval is clamped to a second** before merging. A mob you one-shot is first seen and
  slain inside the same log second, so its raw interval is zero-width: it would contribute its damage to
  the window with no seconds behind it and inflate every rate that divides by them. `durationSec` already
  credits such an encounter one second; this keeps the window math in step. (No effect on a log where
  every mob trades a few blows first — it is the one-shot trash case that breaks.)
- **Stance overview windows** carry the window's own `damage`/`seconds` totals alongside the rows, taken
  from the aggregate **before** zero-damage combos are filtered out of `rows`: a combo I stood in without
  swinging earns no tile but its seconds are still real, and dropping them would inflate the headline
  rate. (Which is why `timeShare` need not sum to 100% — the shortfall is silent time.)
- **Stance overview rows** carry both sides of a combo: `damage`/`dps` from `selfComboLog` (self **outgoing**, tagged with the combo live at each event) and `taken`/`takenPerSec` from `selfTakenComboLog` (its mirror, recorded when I am the *target* and the attacker isn't me — so self-damage never lands in the taken column). `timeShare` is the combo's share of the window's total combat seconds. Both logs share the same merged-window math and are trimmed together as encounters age out. Rates are whole numbers, so a trickle of incoming damage rounds to `0`/sec while the total still records it — the UI shows `<1` for that case.
- **Self encounter history**: `snapshot().encounterHistory` is the last **50** finished encounters seen from my side — my total damage and damage taken, **each also as a rate over the encounter's own length** (`dps`, `takenPerSec`), its start/end and duration, and the **dominant stance combo** (the combo I spent the most seconds in over the encounter's window, via `dominantComboIn` → `comboSecondsIn`). Cached next to `overviewCache` and invalidated on the same event (a new finished encounter). This is what the overview's history chart plots; `recentEncounters` stays at 5 because it carries full per-combatant tables.
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
- `GET /events` → **SSE**, carrying just `snapshot` and `activeLogChanged` (see [Streaming
  protocol](#streaming-protocol) for why there are no delta events). New snapshot fields are defaulted
  at the `useAppData` ingest boundary, so that is the one place version skew is handled — not in the
  components.
- Binds to `127.0.0.1` only.

## Streaming protocol

**The whole state goes over the wire on every push, not deltas.** The M0 draft here specified
`fightStarted` / `fightUpdate` / `fightEnded` / `stanceChanged` / `entityUpdate` events; none were ever
built, because a full snapshot is ~40–60KB of JSON on `localhost` and it makes the client a pure
function of the last message — no replaying deltas, no divergence to debug, and a reconnect needs no
catch-up protocol. Pushes are debounced (~200ms in `app.ts`), so a 30MB backfill sends about ten of
them rather than one per line. Two event types exist:

```ts
// SSE events (server → browser); each SSE `data:` line is one JSON object.
type ServerEvent =
  | ({ t: "snapshot" } & Snapshot)
  | { t: "activeLogChanged"; path: string | null; mode?: "live" | "backfill" };

interface Snapshot {                  // everything the UI draws
  current: Fight | null;              // the fight in progress, full per-combatant detail
  recent: FightSummary[];             // last 20 closed fights — the History pane's list
  activeEncounters: EncounterView[];  // mobs being fought right now
  recentEncounters: EncounterView[];  // the last 5 finished, newest first
  stance: { melee: string; invocation: string };
  stanceOverview: StanceOverviewWindow[];  // one per 10/25/50-encounter window
  encounterHistory: SelfEncounterPoint[];  // last 50 finished, from my side (the chart)
  milestones: Milestone[];            // the rail's marks
  progressWindows: ProgressWindow[];
  progress: { level: number | null; abilityPoints: number | null };
}

interface EncounterView {             // one per-mob card
  name: string; active: boolean; durationSec: number;
  total: number; dps: number;         // whole encounter: damage dealt to the mob, and the combined rate
  npcDamage: MetricStat;              // what the mob dealt back, over the same span
  selfSpark: number[];                // my dps per bucket across the span
  sparkBucketSec: number;             // seconds each bucket covers (>= 1)
  cards: EncounterCard[];
}

interface EncounterCard {             // one row of that card
  name: string; kind: "self" | "player" | "pet"; isSelf: boolean;
  ownerName?: string;                 // charmed pets only, when a cast identified the charmer
  pct: number;                        // share of damage dealt to the mob (the bar)
  activeSec: number;                  // their engaged window — what all three rates divide by
  damage: MetricStat; healing: MetricStat; taken: MetricStat;
}

interface MetricStat {                // every metric group has this one shape
  total: number; perSec: number;      // perSec is DPS, or HPS for healing
  hits: number; crits: number; avoided: number;
  byType: Record<"melee" | "spell" | "dot" | "unknown", number>;
  entries: { name: string; damageType: DamageType; total: number; hits: number; crits: number }[];
}
```

## Frontend

- **React + Vite**, plain CSS. A DPS meter is sorted horizontal bars — no chart lib needed for v1.
- **Sized for a ~540px side panel beside the game**, so vertical space is the scarce resource and the
  root font is **13px**. The chart's own heights stay in **px**, deliberately: shrinking the type must
  never cost the bars their resolution. Consequences of that width, each worth keeping:
  - Grids use **`auto-fit`**, never `auto-fill` — with two stance combos in a 540px row, `auto-fill`
    holds open two empty 120px tracks and strands half the width.
  - A stance tile is **row-wrap**, so one or two combos read as a single line instead of three short
    lines in a mostly-empty box, and restack once several combos share the row.
  - The `% damage / dps / hps / tank / time` labels print **once per section** (`showHead`), not once
    per encounter; the shared grid keeps every table's columns aligned regardless. The five columns
    cost the bar ~35px of its width, which it can spare; the labels are what make them legible.
  - An encounter header is **three parts on one line**: the mob's name (the only part that shrinks —
    `min-width: 0` + ellipsis), the red `→ <n> dps` it is dealing out, and the whole-encounter totals
    pinned right with `margin-left: auto`. The worst realistic case (a long boss title beside
    five-figure numbers) still fits 540px on one line.
  - The self drill-down shows the **top 4** abilities. Six wrapped to three lines at this width, and
    real spell names (`Denon's Disruptive Discord V`) are long enough that truncating them to fit more
    would cost the rank numeral that distinguishes them.
- **Log picker** — dropdown of detected logs (from `/api/logs`) to choose which one is parsed live; remembers last choice.
- **Live pane** — the My DPS panel, then the active encounters, then the last five, all auto-updating.
  Deliberately **unfiltered**: the per-NPC encounter tables replaced the single filtered fight meter this
  pane originally held, and a 540px column has no room for chips that only ever hid rows. The
  combatant-kind filter survives in the **History pane**, where a fight's full roster is the point; the
  by-damage-type and by-stance filters of the original M4 design were never rebuilt after the encounter
  redesign, and the drill-downs (type split, per-ability, stance split) answer those questions instead.
  A live stance indicator in the topbar shows the active melee stance and invocation.
- **History pane** — fight list; select a fight to **drill down**: per-combatant rows → expand to damage-type split, per-ability breakdown, and (for self) the stance split active during that fight.
- **Encounter header** — `<mob> → <n> dps · ENCOUNTER <dur>s · <total> dmg · <n> dps`. The right-hand
  figures are the **whole encounter** (everyone's damage to the mob, and the combined rate against it),
  labelled `encounter` precisely because the rows beneath are per-person and would otherwise be
  mistaken for the same thing; the `title` spells that out. The red figure by the name is what the mob
  is **dealing out** to everyone it fought — the same red the `tank` column uses for damage from mobs.
  It is hidden entirely for a mob that never landed a hit, rather than printing a zero.
- **A sparkline sits between the header and the table** — my damage across the fight, scaled to its own
  peak, answering the one thing an average can't: *when* it landed. Its buckets are a **fixed 11px**
  rather than a share of the row, so the strip's length tracks the fight's duration (a 7-second scrap is
  a stub, a minute-long one spans the panel) and the baseline rule ends where the fight did. Both
  alternatives were tried and rejected against real data: stretching to full width turned a 7-bucket
  fight into a row of wide blocks, and capping bar width inside stretched slots left 9px marks floating
  in 70px of space, reading as scatter. Hidden entirely below four buckets or when I dealt no damage,
  rather than drawing an empty axis.
- **A `time` column ends each encounter row** — the seconds that character was engaged with this mob
  (`EncounterCard.activeSec`, their first contact → the encounter's end). It is precisely the
  denominator of their `dps`/`hps`/`tank` on the same row, which is what makes a 3-second visitor's
  headline rate readable instead of suspicious. It stays deliberately quiet: everyone starts a second
  or two after the mob is first seen, so the accent fires only below **70%** of the encounter —
  otherwise every row lights up and the flag stops meaning anything.
- **A charmed pet gets its own row**, never folded into its charmer — a summoned pet folds
  (it is an extension of its owner's damage), but a charm is a temporary, breakable thing
  whose contribution is worth reading on its own, and it is often not even *our* charm. So
  `kind: "pet"` on an encounter card always means charmed, and it reuses the row styling
  pets already had. The mob keeps its own name, which reads exactly like the enemy it was a
  moment ago, so a **⛓ glyph** carries the identity — at 540px the name is the first thing
  the ellipsis eats — and the charmer's name rides beside it as a quiet tag when known.
  Surfaced 91,180 damage across the real log that was previously invisible. — the damage breakdown line (total, melee/spell/DoT split, crits) and top ability chips render without a click, marked with a blue left rule. Everyone else toggles on click.
- **Number formatting** (`components.tsx`, one `scaleK(n, at)` helper): k-notation past a per-context threshold, one decimal, dropped to zero decimals past 100k so the narrow columns don't overflow. Thresholds — **10k** for the dps/hps columns, **2k** for the tank column (tanking totals climb fastest), **1k** inside the encounter drill-down lines.
- **My DPS panel** — stance-combo cards (avg DPS per melee+invocation over the window) plus an **encounter history chart** below them, both driven by the same 10/25/50 window chip.
  - Each card carries the combo's **defensive cost and usage** under its DPS — `🛡 <taken>/s · ⏱ <share>%` — so a combo that out-damages the rest on 5% of your time reads as the thin sample it is. The full sentence (including the raw seconds behind the share) is in the card's `title`.
  - The header prints **current vs. best**: the combo you're standing in right now against the window's top combo (`current combo −11% vs best (2,400 dps)`), or `best of N` when they're the same. It wraps to its own line in a narrow side panel.
  - **Diverging bars**: my DPS above the baseline, damage taken per second below. **Both halves are rates over each encounter's own length**, so a boss doesn't tower over a trash mob merely for lasting longer, and the two are the same kind of number. They remain *mirrored panels over a shared encounter axis*, **not one scale** — each is normalised to its own peak and both peaks are printed in the header (`▲ peak … dps · ▼ peak …/s taken`), so bar heights are never compared across the baseline (the two rates differ by an order of magnitude; sharing an axis would flatten one of them).
  - **Colour = stance combo**, shared between a card's swatch and its bars. Slots are handed out in the order combos **first appear in the full 50-encounter history**, never by DPS rank — so changing the window or a combo's ranking never repaints an existing bar. Six categorical slots (`--s1`…`--s6`); a seventh combo falls through to the neutral `--s-other`.
  - The six slots are the dark steps of the reference categorical palette, validated against the panel surface `#1c2029` (lightness band, chroma floor, adjacent-pair CVD separation, normal-vision floor, ≥3:1 contrast all pass). Because bar order is chronological, arbitrary combo pairs *can* end up adjacent, and the full six do not clear the stricter all-pairs CVD floor — so identity is never colour-alone: hovering any bar names the encounter and its combo in the header readout, and clicking a card highlights just that combo's bars.
  - Bars cap at 14px wide and stay centred in their slot, so a 10-encounter window reads as a time series rather than a row of blocks. A vertical gradient and rounded caps give them depth; the encounter that set each half's peak carries a hairline outline, so the header's peak figure has a visible owner.
  - A dashed **average line** crosses the DPS half at Σ damage ÷ Σ encounter seconds **over the very
    points being drawn** — computed inside the chart component, so it is by construction the
    duration-weighted mean of its own bars. Never a mean of the per-encounter rates: that would let a
    4-second mob pull on the average as hard as a five-minute boss.
  - **Two honest averages, and why they differ.** The panel header's `avg dps` divides by **merged**
    combat seconds — wall-clock, counted once even when two mobs are up — which is what the stance
    tiles use, so header and tiles always agree. The chart's line divides by the **sum of encounter
    lengths**, which counts a shared second in both encounters. So the line sits *below* the header
    exactly when fights overlap (on a real 25-encounter window: 70 vs 75, from 808s of encounter time
    over 762s of clock). Both are time-weighted and neither is a mean of means; each `title` names its
    denominator.
    The **numerators differ slightly too**, and it is worth being exact about it: the header sums
    `selfComboLog` entries falling inside the merged spans — every point of self damage in that
    wall-clock, including damage to a mob still alive or not yet finalized — while the chart sums the
    self card of each *finished* encounter. On the same window that was 62,416 vs 60,969 (~2%). Both
    are defensible over "the last N encounters"; they are not the same set.
    Per-encounter rates are unavoidably diluted during multi-mob pulls — your damage splits between two
    bars while the clock does not — which, with the wider numerator, is why the header figure is the one
    to quote for "what do I actually do per second".
  - **Milestone rail.** The baseline between the halves is the timeline: level-ups (▲), ability points (◆), AAs and skill unlocks (★), my deaths (✕) and zone changes (»). Each mark sits on the **left edge of the encounter it belongs to** — the first encounter that ended at or after it — so a level-up earned on a kill lands exactly on the boundary between the two bars. Several in one gap (ding → ability point → new AA) cluster, **one mark per kind carrying a count** — four zone changes in the same gap are one `»⁴`, not four glyphs fighting over ~14px of rail; hovering the cluster names all of them. Levels and deaths also draw a full-height guide, because those two are what explain a step change in the bars.
  - Marks are identified by **shape**, not colour — the rail is far too small for colour to carry identity — and hovering any of them replaces the header readout with its full sentence and clock time.
  - Below the chart, a **progression strip** shows current level and unspent AP, then what the window bought: levels, AP, abilities, deaths (in the rail's own glyphs, so the strip doubles as its legend), and — deliberately glyph-less, since they are counted but never marked — skill-ups and summed xp percent.
- **Visual hierarchy** — panels sit on a raised surface above a darker page (`--panel` vs `--bg`, plus a drop shadow). **Active encounters are deliberately loud**: warm gradient, heavier frame, a `--live` accent stripe down the left edge, an accented section header, and a pulsing `⚔` dot (suppressed under `prefers-reduced-motion`). Finished encounters stay neutral so a long recent list doesn't turn into competing accents.
- Reconnects to SSE automatically; renders from the last snapshot on load.

## Tech stack & packaging

- **Language/runtime:** TypeScript on **Node.js 22** (already installed). Dev via `tsx`; tests via `node --test`.
- **One test runner for both halves.** `node --test` globs `src/**` *and* `web/src/**`, so the UI's own
  arithmetic is covered without a browser runner: the pure parts live in DOM-free modules
  (`web/src/format.ts`, `web/src/stats.ts`) that it can import directly. Node's types are confined to
  `web/tsconfig.test.json` so a component still can't reach for `process` and typecheck — and that
  config **must clear the inherited `exclude`**, or the test files it exists for are filtered straight
  back out and the check passes on nothing.
- **Verifying the UI** means SSR + screenshot, not a headless load: the page holds an open `/events`
  stream, so `--screenshot` never fires. Render a component with `renderToStaticMarkup` into a shell
  that inlines `styles.css`, feed it a real `/api/snapshot`, and shoot the `file://` page.
- **Runtime dependencies:** aim for none in the backend (built-in `node:http`, `node:fs`); React/Vite are frontend build-time only.
- **Distribution (M5):** **Node SEA** (single-executable app) bundling the built SPA → one file to double-click. If cross-compiling to Windows proves cleaner via Bun's `--compile`, we can switch the packaging step without touching app code.
- **Config:** JSON/`.env` for `logDir`, `port`, `inactivityTimeout`; auto-detects the newest `eqlog_*.txt`. Env override `EQL_LOG_DIR`.

## Platform independence

Only the **default log directory** is OS-specific (per-OS lookup table: macOS Wine bottle / Windows `.../Logs` / Linux Wine prefix). The tailer, parser, engine, server, and UI are all OS-agnostic — the "runs on a PC too" goal is essentially free.
