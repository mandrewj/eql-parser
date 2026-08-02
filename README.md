# EQL Parser

A local, cross-platform **combat parser and quest tracker for EverQuest Legends**. It reads your
character log as you play and shows a live damage meter, a browsable history of every fight, and a
Plane of Sky quest tracker that knows what you already have.

Everything runs on your own machine. No account, no cloud, no data leaves the computer — it is a
small local process that reads one log file and serves a web page to your browser.

---

## What you get

**A live damage meter, per mob.** Not one meter for "the fight" but a card for each NPC you are
engaged with, so two mobs at once are two readable tables. Each card shows every combatant's
damage, healing and damage taken, with a timeline of the exchange and a drill-down into damage
types and individual abilities.

**Pets counted properly.** The pet you summon folds into your row. A mob you or a groupmate
*charms* gets a row of its own, with the charmer named where the log makes that knowable.

**Your own performance over time.** A chart of your last 50 encounters — damage dealt above the
line, damage taken below — coloured by the stance combo you were in, with level-ups, AAs and
deaths marked on the timeline.

**Stance analysis.** What each melee-stance and invocation pairing is actually worth: its DPS, the
damage it costs you defensively, and how much of your combat time you spent in it.

**"What killed me."** Every death, reconstructed from the incoming hits before it — who, what, how
much, and which stance you were in.

**Loot and progression tracking.** A mote ladder showing which tier drops where, against zone
difficulty. Level and AA pacing. Time-to-level.

**A Plane of Sky quest tracker** for all 16 classes: what every quest needs, what you are holding,
what is ready to hand in. It reads your in-game inventory export and the log together, so nothing
is ticked off by hand. [More below.](#the-plane-of-sky-tracker)

---

## Setup

You need [Node.js](https://nodejs.org) 20 or newer. Nothing else.

**Easiest:** double-click **`start.command`** (macOS/Linux) or **`start.bat`** (Windows). The first
run installs dependencies and builds the interface, then opens `http://localhost:8787` in your
browser. Close the window or press `Ctrl+C` to stop.

From a terminal instead:

```bash
npm install
npm run dev      # builds the UI, reads your log, serves the app
# then open http://localhost:8787
```

On startup it looks for your logs folder in the usual place, picks the newest character log, reads
the whole thing to reconstruct your history, and then follows it live. A large log takes a few
seconds to catch up.

### If it cannot find your logs

Click the **⚙** button in the top right, then **Browse…**, and pick the folder holding your
`eqlog_<Character>_<server>.txt` files. Folders containing logs are marked with a count, so you can
spot the right one. It is normally:

```
macOS    ~/Library/Application Support/osxEQL/prefix/drive_c/users/Public/
             Daybreak Game Company/Installed Games/EverQuest Legends/Logs/
Windows  C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends\Logs\
```

Note it lives under the **Public** user, not yours, and that the game spells the folder `Logs` on
some installs and `logs` on others — it is found either way. You can also paste the path directly,
or set `EQL_LOG_DIR` before launching.

**Turn logging on in game** if you have not: `/log on`. Without it the file never grows and the
parser has nothing to read.

---

## Using it

The top bar shows the character being read, the melee stance and invocation you are currently in,
and whether the connection is live. The **⚙** button opens the folder and character pickers.

Three tabs:

### Live

What is happening now, top to bottom:

| Section | What it answers |
|---|---|
| **My DPS** | How am I doing across recent encounters, and which stance is earning it |
| **Stat tabs** — Levels · AA · Stances · Motes · Deaths | Slower-moving questions; click one to open, click again to close |
| **Active** | The mobs you are fighting right now, one card each |
| **Last N encounters** | The ones that just finished |

Click any combatant row to expand it into a damage-type split and a per-ability breakdown. Your own
row stays open, so your numbers are always on screen.

### History

Every fight the session has seen, oldest at the bottom. Pick one to inspect its full roster, with
the same drill-downs plus the stance split for that fight. The combatant filter lives here rather
than on the Live tab, because a finished fight is when you want to slice the roster.

### Sky

The Plane of Sky class quests. See below.

---

## The Plane of Sky tracker

Sky quests want a Wind Rune plus one or two specific drops, across 95 quests and 16 classes. The
tracker works out what you are holding and what is left.

### Feeding it your inventory

In game, type:

```
/outputfile inventory
```

That writes `<Character>_<server>-Inventory.txt` next to your game folder. The tracker finds it on
its own — it is matched to whichever character log you have selected — and picks it up within a few
seconds of the game confirming the write. You do not have to tell the app anything.

**Put it on a hotbutton and press it around every Sky run.** Make a social containing
`/outputfile inventory`, drag it to a hotbar, and hit it when you zone in and again when you are
done. It costs a keypress and it is what keeps the tracker honest.

Between exports the app keeps up from your log, so you do not need to re-export after every drop —
anything you loot is added on top of the last export as it happens. What the log **cannot** see is
things leaving your bags:

| The log tells the app about | Only a fresh export tells it about |
|---|---|
| Anything you loot, as you loot it | Components consumed by a turn-in |
| Runes routed to the currency tab | Items sold, destroyed, traded, or moved to another character |
| Quest rewards you are handed | Anything you picked up while the app was closed |

So the export is the correction and the log is the running total. Re-export often enough and the
two never drift; a run's worth of drift is small, a week's is not.

Turn-ins are handled without an export: when the giver hands you the reward, the app knows which
quest that finished and takes its rune and components back off your count. That matters most for
wind runes, which live in the currency tab and so are the one thing an export can never correct.

> **The remaining gap** is a turn-in the app did not witness — one you did while it was closed. Its
> reward will show the quest as complete, but the parts it consumed stay counted until your next
> export clears them (or forever, for anything from the currency tab or the Dragon Hoard). Running
> the app while you hand quests in avoids it entirely.

**Two views**, switched at the top:

- **By class** — one class at a time. Each quest shows its rune, its components and its reward,
  with a state: ○ nothing yet, ◐ partway, ◆ everything in hand, ✓ finished. Hover an item to see
  which mob drops it.
- **By island** — everything outstanding, grouped by where it drops and then by the mob that drops
  it, most-wanted first. Things you already have sort to the foot of each island. **Wind Runes lead
  the list**, because they drop from any mob in the zone and one rune is wanted by six or seven
  quests on average.

The box at the top is the actionable part: what is **ready to turn in** right now — with the quest
giver and the phrase to say — and what you have recently completed.

> One caveat worth knowing: readiness is per-quest. If two quests both want a rune and you hold
> one, both show ready, because you genuinely can hand either one in. The rune group in the island
> view is where the shortfall shows (`1/7` means one in the bag, seven quests want one each).

---

## Why a local app rather than a website

A browser cannot watch a file on your disk. The log lives deep inside the game install, and a
sandboxed web page has no way to follow it as it grows — nor to hand a server the real path to a
folder you picked. So the app is a small native process that does the reading, paired with a
browser UI it serves over Server-Sent Events. That is also why it works offline and why nothing
needs an account.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together.

---

## Build and distribute

```bash
npm run build              # web UI + a single self-contained dist/eql-parser.cjs
node dist/eql-parser.cjs   # runs anywhere Node is installed — no other files needed

npm run package:sea        # optional: native single-file executable (dist/eql-parser)
```

- **`dist/eql-parser.cjs`** embeds the interface, so that one file is the whole app on any machine
  with Node. Drop it in, run it, open the browser.
- **`npm run package:sea`** wraps that bundle into a native executable via Node's Single Executable
  Applications. Nothing to install on the target — every OS already has a browser.

Other commands:

```bash
npm test                        # unit tests
npm run report -- <fightNumber> # terminal-only DPS report for one fight
npm run parse:check             # audit the parser against your whole log
npm run dev:server              # backend only, with reload
npm run dev:web                 # Vite UI on :5173, proxying the API — for UI work
```

Set `EQL_PORT` to serve on a port other than 8787.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, the tailer, the SSE protocol, packaging.
- [`docs/LOG_FORMAT.md`](docs/LOG_FORMAT.md) — the log grammar, with real examples and parsing rules.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — how it got here, and what each decision cost.

## Prior art

Parsing logic is adapted from [kauffman12/EQLogParser](https://github.com/kauffman12/EQLogParser)
(C#, Windows-only). EverQuest Legends uses the *classic* EverQuest log format, the same family that
parser handles. The Plane of Sky quest data is generated from the
[EQL wiki](https://eqlwiki.com/Plane_of_Sky).
