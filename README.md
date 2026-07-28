# EQL Parser

A local, cross-platform **DPS parser for EverQuest Legends**. It tails your
character log in real time, splits combat into individual fights, and shows a
live damage meter plus a browsable history of past fights in your web browser.

> Status: **design / roadmap phase.** No application code yet — see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## What it does

- Watches the EverQuest Legends log file live (melee, spell nukes, DoT ticks, crits, misses).
- Detects where one fight ends and the next begins.
- Computes per-fight, per-player DPS with a classic meter breakdown.
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
process that feeds a browser UI over WebSocket. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Distribution goal

Ship a **single self-contained executable** (built with `bun build --compile`, which can
also cross-compile a Windows `.exe`). On any other machine: drop the file, double-click,
the browser opens. Nothing else to install — every OS already has a browser.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, tailer, WebSocket protocol, packaging.
- [`docs/LOG_FORMAT.md`](docs/LOG_FORMAT.md) — the log line grammar, with real examples and parsing rules.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones from first parse to packaged binary.

## Prior art

Parsing logic is adapted from [kauffman12/EQLogParser](https://github.com/kauffman12/EQLogParser)
(C#, Windows-only). EverQuest Legends uses the *classic* EverQuest log format, which is the
same family that parser handles.
