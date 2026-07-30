# EQL Parser

A local, cross-platform **DPS parser for EverQuest Legends**. It tails your
character log in real time, splits combat into individual fights, and shows a
live damage meter plus a browsable history of past fights in your web browser.

> Status: **v1 complete (M0–M5).** Live tailer → parser → engine → web UI, packaged as a
> single self-contained file (and optional native binary). See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quick start

**Easiest:** double-click **`start.command`** in Finder. On first run it installs
dependencies and builds the UI, then it opens `http://localhost:8787` in your browser and
serves the app. Close the window (or press Ctrl+C) to stop.

Or from a terminal:

```bash
npm install          # if the npm cache errors, add: --cache /tmp/eql-npmcache
npm run dev          # builds the web UI, then tails your log + serves the app
# open http://localhost:8787
```

It auto-detects the newest `eqlog_*.txt`, backfills history, and updates live as you play.
Switch characters with the log picker. For UI hot-reload while developing:
`npm run dev:server` (backend) + `npm run dev:web` (Vite on :5173, proxies the API).

Terminal-only DPS report: `npm run report -- <fightNumber>`.

## What it does

- Watches the EverQuest Legends log file live (melee, spell nukes, DoT ticks, named ability
  hits, heals, crits, misses).
- Detects where one fight ends and the next begins.
- Computes per-fight, per-player DPS with a classic meter breakdown.
- Counts **pets on your side** — both the one you summon (folded into your row) and any mob
  you or your group **charm**, which gets a row of its own with its charmer named.
- Serves a live-updating web UI on `http://localhost:<port>` — no cloud, no account, everything stays on your machine.

## Why a local web app (and not a browser-only tool)

The log lives deep in the Wine bottle:

```
~/Library/Application Support/osxEQL/prefix/drive_c/users/Public/
  Daybreak Game Company/Installed Games/EverQuest Legends/logs/eqlog_<Char>_<server>.txt
```

That path is a perfectly normal macOS file, so a **native process can tail it live**
with no trouble. A sandboxed browser *cannot* watch an arbitrary filesystem path in
real time — which is exactly why the architecture is a small native tailer/parser
process that feeds a browser UI over Server-Sent Events. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Build & distribute

```bash
npm run build          # web UI + a single self-contained dist/eql-parser.cjs
node dist/eql-parser.cjs   # runs anywhere Node is installed — no other files needed

npm run package:sea    # optional: native single-file executable (dist/eql-parser)
```

- **`dist/eql-parser.cjs`** — the web UI is embedded, so this one file is the whole app
  on any machine that has Node. Drop it in, run it, open the browser.
- **`npm run package:sea`** — wraps that bundle into a native executable via Node's
  Single Executable Applications (auto-thins macOS universal binaries and re-signs).
  Nothing to install on the target — every OS already has a browser.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, tailer, SSE protocol, packaging.
- [`docs/LOG_FORMAT.md`](docs/LOG_FORMAT.md) — the log line grammar, with real examples and parsing rules.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones from first parse to packaged binary.

## Prior art

Parsing logic is adapted from [kauffman12/EQLogParser](https://github.com/kauffman12/EQLogParser)
(C#, Windows-only). EverQuest Legends uses the *classic* EverQuest log format, which is the
same family that parser handles.
