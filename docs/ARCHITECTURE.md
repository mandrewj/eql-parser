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

### Config / log discovery
- **The log naming rule lives here once**, as `isLogFileName` beside `parseLogFileName`: both
  `listLogs` and the folder picker's per-directory count ask the same question of a file name, and
  a second copy would be one more place to miss if the game ever renamed its logs.
- The default logs directory is the one genuinely **OS-specific** thing in the app; everything
  downstream (the inventory export above all) is derived relative to whichever log is open.
- **The folder's capitalisation is not assumed.** The game creates it as `Logs`; this project has
  always spelled it `logs`. macOS and Windows are case-insensitive by default so the mismatch never
  showed — but on a Wine bottle sitting on a case-sensitive Linux filesystem the exact-match lookup
  fails and the app reports no logs on a machine that has them. `resolveLogDir` retries by scanning
  the parent for a case-insensitive match of the **last** segment only, since that is the segment
  this project spells out; the parents come from the OS.

### Tailer
- Opens the log and tracks a **byte offset**; on each change reads only new bytes.
- **CRLF-safe & partial-line-safe**: buffer trailing bytes until `\n`; strip `\r`.
- Change detection: `fs.watch`/FSEvents **plus a stat-based polling fallback** (1s — `app.ts` passes it, and it is also the `Tailer` default).
- **Rotation/reset handling**: if size < last offset or inode changes, reset (truncation, `/log` toggle, new session).
- Modes: **live** (start at EOF, follow) and **backfill** (parse whole file, then follow).
- **Reads in 1MB chunks, never the whole span at once.** A live append is a few hundred bytes and
  takes one pass either way; the chunking is for the backfill, where "the new bytes" is the entire
  171MB log. Three separate costs, all measured (`READ_CHUNK_BYTES`):
  - **The port answered nothing for 13.1 seconds.** One `Buffer.alloc(fileSize)`, one `toString`,
    one `split`, then 2.2M synchronous `onLine` calls — the event loop never yielded, so the
    launcher's "open the browser once `/api/config` answers" loop waited out the whole backfill.
    Now **0.13s**, because the `await` between chunks lets the server breathe.
  - **Peak RSS 1207MB → 580MB.** The buffer, the string it decoded to and the 2.2M-entry array it
    split into were all live simultaneously.
  - **Resident heap 400MB → 206MB, for the whole session.** This is the one that is not obvious
    from the code: a substring in V8 is a *slice* holding a reference to its parent, and the engine
    keeps names out of the lines it is handed — abilities, mobs, zones. A single retained name pins
    the entire string it was cut from, so decoding the log in one piece kept all 171MB of it alive
    long after the backfill finished. Chunking bounds any such slice to one chunk.
  - Decoding is via `StringDecoder`, so a multi-byte character landing on a chunk boundary is held
    and completed rather than corrupted — the old code carried a comment asserting the log was
    ASCII, which is the sort of assumption worth deleting rather than restating. Tests cover a
    multi-chunk backfill, a line longer than one chunk, and a character split across the seam.
- **Switchable at runtime**: the active log is chosen by the UI; the tailer can stop and re-open on a new path without restarting the process.

### Stopping it
- **One path for every way of stopping** — Ctrl+C, a `kill`, or the button in the panel all reach
  the same `shutdown()` in `index.ts`, which logs why, closes the server and exits. Re-entrant
  (a second Ctrl+C during the first is ignored) and backed by a 3s **hard-exit timer**: a stop that
  hangs is worse than no stop.
  - Ending the SSE responses is what lets `close()` finish — they are the only connections held
    open indefinitely. `closeAllConnections()` was tried and measured against a real browser
    holding the page: **0.15s with it, 0.17s without**, so it was insurance against nothing and
    came back out. The guarantee is the timer.
  - **The server announces it before going** (`{ t: "shutdown" }` over SSE). A dropped stream alone
    cannot distinguish a stop from a crash or a rebuild, and the panel should say *you did this*
    rather than blink to offline and retry every 2s forever. The client latches that, closes its
    `EventSource` so it stops reconnecting to a dead port, and shows what to run to get it back.
  - **Why it exists at all**: the launcher's terminal is not always still there to Ctrl+C.
    `start.command` exits its shell and the process reparents to `launchd`, after which the only
    way to stop it is `lsof` and `kill` — which is exactly how every restart in this repo's
    development has been done.

### Parser
- Pure function `parseLine(raw) → CombatEvent | null`.
- **Keyword prefilter** before regex (skip lines lacking `damage`/`slain`/`but miss`/`assume`/…).
- **Typed ability damage** (`You hit X for 151 points of magic damage by Smiting Strike.`) is
  its own pattern, tried *after* the melee ones: melee is the biggest group in the log by far
  (186k lines against 27k), so it must not pay an extra regex, and the type adjective the
  melee patterns refuse is exactly what makes the two unconfusable. Recorded as `spell` damage
  carrying the real ability name. It went unparsed until now — ~15% of the self's damage — and
  `parse:check` reported the log clean throughout, because its own relevance regex shared the
  blind spot; that regex now allows the adjective, which is what makes the check honest.
- Event types: `MeleeDamage`, `SpellDamage`, `DotTick`, `Miss`, `Death`, **`Stance`**, `Heal`, `Pet`, **`Charm`**, **`Who`**, **`Loot`**, **`Given`**, **`OutputFile`**, `Zone`, **`Progress`**. Grammar in [`LOG_FORMAT.md`](LOG_FORMAT.md).
- **The trailing flag is read once, by one helper**, for every form that can carry one — melee,
  typed ability, DoT tick and heal. Two facts about it drove the shape:
  - **Flags compose.** `(Riposte Strikethrough Critical)` is a real line, as are
    `(Critical Double Bow Shot)` and `(Riposte Crippling Blow)`, so reading one is a *search*
    across the parenthetical rather than a match against it.
  - **Three crits never say "Critical".** `(Crippling Blow)`, `(Slay Undead)` and
    `(Finishing Blow)` are critical hits emitted **in its place**, never beside it — so counting
    only the literal word loses them. In a 2M-line log: 26,463 `Critical`, 363 `Slay Undead`, 114
    `Finishing Blow`, 112 `Crippling Blow`. The self's own melee crit rate moves 8.24% → 8.32% on
    the strength of 107 Crippling Blows alone. The event carries a `critKind` naming which of the
    four it was, so the panel can break them out.
  - The rest of the set stays out, because it answers a different question: `(Riposte)` and
    `(Strikethrough)` say how the swing *resolved*, `(Flurry)`, `(Rampage)` and
    `(Double Bow Shot)` say it was an *extra* one. Neither is a critical hit.
- **`SpellDamage` carries the line form it was read from** (`ability` | `nonmelee`). The two look
  nothing alike and, more to the point, only one of them can ever be flagged — see the crit ledger
  under [Engine](#engine). The `nonmelee` pattern captures its trailing parenthetical even though
  no such line has ever carried one: that zero is a *measurement*, and the panel reports it as
  one, so the parser reads what the line says instead of deciding the answer in advance.
- **`Who`** carries a player's level and classes from a `/who` result. It is not combat and
  never touches a fight; it exists solely because that line is the only place the log states
  anyone's class, which is what makes a charm attributable (below).
- **`Charm`** carries one of three states — `cast` (someone began a charm spell; names the
  caster, not the target), `on` (a mob became charmed; names the target, never the caster)
  and `off` (a charm broke). The two halves never share a subject, so pairing them is the
  *engine's* job — the parser stays a pure function of one line. Charm lines are ~0.07% of a
  real log, so the whole block sits behind one token test and is tried after every damage
  pattern; it falls through to `Progress` rather than returning, since an AA can be named
  for a charm spell.
- **`Loot`** is the "this item is yours" family, and it has **two shapes that share no
  punctuation**. The fenced one (`--You have looted a X from Y's corpse.--`) is what a bag pickup
  writes, and the only one motes ever use. An item the game routes straight into an auto-storage
  writes the other, with no `--` fence, no trailing full stop and a different verb tense:
  `You looted a Wind Rune Azia from a thunder spirit's corpse and stored it in your currency`.
  Three destinations occur in a real log — `currency`, `tradeskill depot` and `Dragon Hoard` —
  and the destination is carried on the event because the inventory export does not cover all
  three (see [Engine](#engine)). This is not an edge case for the Sky tracker: **wind runes are
  routed to the currency tab**, so without the second shape every rune looted is invisible. The
  *sold it* and *to create* variants are still excluded; the `and stored it in your` literal is
  what separates the keeping form from the ~5,400 selling lines it otherwise matches word for
  word. Not combat, and never touches a fight.
- **`Given`** is `You have been given: <Item>` — an NPC handing something over, which is what the
  end of a turn-in looks like. It is the **only line that dates a quest completion**: holding the
  reward says a quest is finished, never when. Three lines in 1.5M, so it is tried late and gated
  behind `been given` in the prefilter. It stays general — deciding which handovers are Sky
  rewards is the engine's job, and a real log's three are all something else.
- **`OutputFile`** is `Outputfile Complete: <file>`, the game confirming it has written an export.
  It never reaches the engine — the **app** consumes it, because the app owns the file — and it
  turns `/outputfile inventory` into a refresh that has already happened by the time you alt-tab,
  instead of one that waits for the next poll. Merely *mentioning* the command in chat does not
  match, which a real log contains.
- **`Progress`** covers self progression — level-ups, ability points, AAs bought/ranked, skill
  unlocks, skill-ups and xp ticks. These are orders of magnitude rarer than damage lines, so they
  are tried **last**, behind a single `^You (have )?(gain|become|improved)` prefix test: the hot
  path never pays for them.
- Deterministic, side-effect-free → unit-testable against fixture lines.
- **Coverage is audited by clustering, not by a relevance regex.** Every gap found so far hid
  behind one: `parse:check`'s own filter shared the parser's blind spots and reported the log
  clean while ~15% of the self's damage went unread. The audit that works runs every line through
  `parseLine` and ranks what returns `null` by shape. Three unparsed lines in 785k now carry a
  number and a combat word; `LOG_FORMAT.md` lists them so the next pass doesn't re-derive them.

### Reference data and the inventory export
Three modules beside the parser hold *game facts* rather than parsing rules — [`spells.ts`](../src/parser/spells.ts)
(charm messages → caster class), [`motes.ts`](../src/parser/motes.ts) (the mote ladder, zone
difficulty) and the Plane of Sky pair below.

- **[`sky-catalogue.ts`](../src/parser/sky-catalogue.ts) is generated, not written.**
  `scripts/build-sky-quests.mjs` fetches the wiki's Plane of Sky page and emits the whole table:
  16 classes, 95 quests, 127 item slots, 113 distinct components. Tables are matched by their
  header row, and the script **throws** on a class heading it cannot name, an island tag it does
  not recognise or a reward it cannot parse — a wiki change fails the run rather than silently
  writing a thinner catalogue. Baked into the binary because the app is offline-first.
  - **Drop sources come from a second site**, [`eqlposky.com/data.js`](https://eqlposky.com/), because
    the wiki's loot table covers them badly: it left **25 of the 113 components with no mob at all**,
    which the panel could only render as a "no mob listed" heading meaning *we don't know*. The
    second source states one `source` per item as `Island <n>: <mob>`, joined by ` / `. Quests,
    runes and rewards still come from the wiki alone.
    - **Read by regex, never evaluated.** It is a remote script, and a build step that runs one is a
      supply-chain hole for a table of mob names. Both quote styles are handled — an entry whose
      source contains a nickname is written with single quotes (`'Island 6: Bazzt Zzzt "Bees"'`),
      and a double-quote-only pattern silently skipped exactly those.
    - **Union, wiki first: the second source fills gaps and adds names, never removes one.** The
      wiki is often the more specific of the two — `Bazzzazzt, Bizazzzt, Bzzzt` against `"bee"
      mobs` — so a rule that simply preferred the newer source would throw that away. Collectives
      (`drake/sphinx/spirit mobs`) are taken only when nothing else is known: beside three named
      mobs they say the same thing again, vaguely.
    - **Names are matched on a folded key**, since the two sites disagree on capitalisation
      (`Crown Of Elemental Mastery` against `Crown of Elemental Mastery`) — the same folding
      `sky.ts` does for the game's own spelling, for the same reason.
    - **An island is adopted only when every mob it names is on one.** Several islands means the
      Efreeti cycle, which is exactly the case the wiki tags with no island — so "no island"
      survives as the answer instead of being overwritten by whichever number came first. In the
      current data this rule moves nothing: every component either carries the wiki's own tag or is
      a cycle drop. It is a **guard**, not a fill — without it the cycle dissolves into whichever
      of its three islands each item happened to name first.
    - **`Various` and `None?` are discarded** rather than filtered downstream. They are the wiki
      declining to answer, and `Various` sorts to the front of a comma list — straight into the
      group heading, which is the one job a mob name has here.
  - **`DROPS_FROM_OVERRIDES` is where we disagree with *both* sources**, applied last and
    **replacing** rather than unioning — the point of an override is that a source is wrong, and a
    union would keep the wrong answer beside the right one. It throws if an override names an item
    neither page lists, so a stale correction fails instead of sitting there. Three entries:
    - `Gem of Invigoration` — the wiki credits the Protector of Sky; eqlposky names a greater
      sphinx, which matches the item's own `7-Trash` tag.
    - `Efreeti Great Staff` — comes off the **Eye of Veeshan**, not the Efreeti cycle both sources
      also list, which is what moves it onto Island 8.
    - `Efreeti Statuette` — back **into** the cycle. Both sources file it with Island 4's essence
      mobs, having inherited the same mistake from an older game; the log settles it with four
      pickups, one from each of `Noble Dojorn`, `Overseer of Air` and `the Hand of Veeshan`, and
      none from an essence mob in 2.4M lines.

    That last pair is the caution about the sources: **agreement between two sites is not
    independence** when one copied the other's ancestor, so the 106 items where they agree
    corroborate each other less than the number suggests. Tests assert all three overrides
    survived, because a regenerated file looks freshly generated whether or not they did, plus one
    that **every** component names a mob — if that fails, the merge silently stopped merging.
    - **`island: null` in an override is a decision, not an absence**, so the check is whether the
      key is *present* rather than whether its value is truthy. Without that, "belongs to no island"
      fell through to the island the second source infers from the mob, and the Statuette left the
      cycle again on the next run.
- **[`sky.ts`](../src/parser/sky.ts) owns the matching**, which is where the wiki and the game
  disagree: the game writes a backtick apostrophe, appends `+N` to an upgraded item and
  `(Exaltation)` to an exalted copy, and disagrees on capitalisation (`Crown Of Elemental
  Mastery`). All of it folds to one normalised key. That the suffixes name the *same* item is
  not an assumption — a real export gives `Foo`, `Foo +4` and `Foo (Exaltation)` the same item id.
  Components, runes and rewards never collide once folded (a test asserts it), so a single map
  lookup answers "is this a Sky item, and what kind" for every loot line.
- **[`inventory.ts`](../src/parser/inventory.ts) reads the export** the game writes on
  `/outputfile inventory`: a TSV of every slot the character can see — worn, bags, both banks,
  shared bank. That breadth is what makes it usable as a baseline; an item in the bank is held.
  - **It is tied to the selected log by character and server, and by nothing else.** The game
    names the pair `eqlog_<Char>_<server>.txt` and `<Char>_<server>-Inventory.txt` from the same
    two words, so the export is *derived* from whichever log the picker has active — never
    configured, never assumed. Change character and the whole tab follows.
  - **The location is relative to that log — no absolute path, no install root, no platform
    branch.** The install sits somewhere different on every machine and somewhere very different
    on Windows, so the only durable landmark is the log the user already chose:

    ```
    <install>/logs/eqlog_<Char>_<server>.txt   ← given
    <install>/<Char>_<server>-Inventory.txt    ← one level up
    ```

    `dirname` twice is the whole rule — once to the logs folder, once to the directory that
    *holds* it — so nothing depends on that folder being called `logs`, on how deep the install
    is, or on which OS it is. `path.join` supplies the host's separator. A second candidate, the
    log's own folder, covers `EQL_LOG_DIR` pointing at a directory holding a copied pair with no
    `logs/` level to climb out of.
    - The derivation is **pure and IO-free** (`inventoryCandidates`), split from the existence
      check, precisely so the Windows layout can be *tested* from a Mac by passing `path.win32`
      rather than asserted in a comment. (Discovering the logs folder in the first place is the
      one genuinely platform-branched thing, and it lives in `config.ts`.)
  - **A missing export still reports its path**, because "not written yet" is the normal starting
    state and the panel has to name the file it is waiting for. `inventoryMs` is the field that
    says whether it was actually read; `inventoryPath` says which file is meant either way.
    - The change test in `app.ts` is therefore **the path *and* the mtime**. An mtime-only check
      looks right and is not: selecting a character with no export leaves the mtime `null`, which
      is what it already was, so the comparison short-circuits and the freshly built engine is
      never told which file it wants — `setActiveLog` replaces the engine, so "nothing changed"
      is never true across a switch. Caught by switching to a second character and finding the
      panel blank instead of waiting.
  - **It has two sections.** After a blank line the file restarts with a `KeyRing / Name / ID`
    header and three-column rows. Those are real holdings — in a real export none of the 17
    keyring ids appears in the main section — so a width check tuned to the main section's five
    columns drops all of them, which is precisely wrong here: a finished quest's reward is just
    the sort of item that lives there. Rows are identified by their **header** (`Name` in the
    second column), not by column count, and a section with no `Count` means one of the item.
  - A missing export is the normal state until the player writes one, so it returns null rather
    than throwing.

### Engine
- **Entity roster** — players, pets, and **NPCs are all first-class**; each can be inspected for outgoing damage.
- **Plane of Sky holdings are derived, never stored.** There is still no persistence in this app;
  the export plus the log is enough to re-derive the answer on every start, which is what keeps
  it that way. The engine does no file IO — the app reads the export and hands it over with
  `setInventory` — and the two sources meet at the export's mtime.
  - **They must not overlap.** The export already counts everything looted before it was written,
    and backfill replays the *whole* log on every start, so adding each Sky pickup on top would
    double every item already held — not occasionally, but every single run. Only pickups after
    the mtime are added.
  - **The cut-off is applied when the snapshot is built, not when the line is read.** That is what
    lets a freshly written export re-baseline instantly, with no replay: the app notices the new
    mtime — on the `Outputfile Complete:` line, or failing that on its 3s tick — hands over the
    new inventory, and the same recorded loot is filtered against a later boundary.
  - **One destination is exempt from the cut-off, and it has to be.** The cut-off assumes the
    export can see everything, which is what makes discarding an older pickup safe. The
    **currency tab is not in the export at all**: a Wind Rune Azia routed there at 13:20:57 is
    absent from an export written 51 seconds later, while two runes that went to a bag in the
    same minutes are both in it. For such an item the cut-off does not prevent a double count —
    there is nothing to double — it simply deletes the item, and nothing ever restores it. So
    pickups into an unexported storage count whenever they happened.
    - **Which storages those are was measured, not guessed**, by replaying every stored pickup
      that predates an export and looking for it in that export. `currency` and `Dragon Hoard`
      are absent: of 19 distinct Dragon Hoard items, 12 appear nowhere, and the 7 that do are in
      `Equipment` or a `Bank` slot — separate copies, not the hoard. The `tradeskill depot`
      **is** covered: an export carried a `Personal-Depot` section holding exactly the items the
      log had stored there, so exempting it would double-count. (A later export shows none of
      them only because the depot had been emptied — which is why the test is "is there a
      section for it", not "is it empty today".) The list lives in
      [`inventory.ts`](../src/parser/inventory.ts).
  - **A turn-in is the other half of the ledger, and obeys the same cut-off.** Handing a quest in
    is a **trade**, and `You offered <n> <item> to <npc>.` is the only line in the log that says
    anything **left** the bags — so that, not the reward, is what the deduction rests on. Offers
    are buffered until `You complete the trade with <npc>.`, because an offer alone is a window
    that may still be closed. This replaced an earlier scheme that inferred the cost from the
    reward: a real log turns out to write **no** reward line for a Sky turn-in at all, so that
    scheme deducted nothing and the counts only ever rose. The rule mirrors acquisition exactly:
    subtract a consumption **after** the export (the export counted something since handed in);
    do **not** subtract one from before it (the export already shows the loss — subtracting again
    would count it twice); but **always** subtract for an item from a storage the export cannot
    see, because its acquisition bypassed the cut-off too and nothing else would ever remove it.
    Counts are clamped at zero, since a turn-in can be witnessed for an item whose pickup predates
    the log.
    - Deduplicated by **quest**, not reward: Beastlord's Test of Claw hands over a weapon for each
      hand and consumes its parts once, and the trade and any reward line are two sightings of one
      turn-in.
    - **The trade also identifies the quest**, which is how completion is detected without a reward
      line: the giver narrows it to one class and the items pick between that class's quests. A
      quest is only claimed when every part it wants was offered.
    - **Completion is permanent.** It is an event, so `progressOf` trusts it over holding the
      reward — rewards get banked, sold or worn by another character, and none of that un-finishes
      a quest. Holding the reward remains the fallback for a completion the log never saw.
    - What remains uncorrected is a turn-in made while the app was not running: it saw no trade, so
      the quest is not marked complete and its parts stay counted until the next export clears them
      — never, for the currency tab.
  - **Each holding reports where it was last seen** (`inv`, `bank`, `shared`, `depot`, `keyring`,
    `DH`, `currency`) — the export's own slot where it can see the item, otherwise the storage the
    log said it was routed into. "You have it" and "you have it on you" are different answers.
- **A charm landing is not a charm until it proves it took.** The `eyes glaze over` emote is
  shared by the bard's charm song and its *mesmerise* songs, and a charm song pulses onto whatever
  is in range — including the mob the group is beating on, where the next swing breaks it. Measured
  on a real log: of 24 landings on `a greater sphinx`, **23 broke within 5 seconds to our own
  attacks**, median gap one second. Treating each as a life change banked and wiped that encounter
  **21 times in six minutes**, and it was not one mob's problem — 674 landings across 70 names.
  - So a landing goes to `pendingCharms` and affects **nothing** — not the classifier, not
    `everCharmed`, not the encounter. It is promoted when the mob does something only a pet does:
    **attacks another mob**, or **calls you Master**. That instant is also exactly where the two
    lives divide, so it is the right moment to bank the first — one blow later than before in the
    true case, and never at all in the flicker case.
  - A landing that breaks before it is confirmed is simply forgotten: it banked nothing, so there
    is nothing to restore and no encounter to restart.
  - **Kinds are resolved *before* the charm goes into force**, in both promotion paths. Setting it
    first makes the mob read as ours, which skips the bank and silently merges the enemy life it
    just finished into the pet's. That was a live bug for the length of one commit.
  - Measured after: the same window opens the encounter **5 times instead of 21** — matching the
    five sphinx deaths actually in the log — and its peak total rises from 12,838 to 30,886 damage.
    Session damage and damage taken are unchanged to the digit (814,507 / 322,109).
- **Charmed pets are a *window*, not a fact.** The same mob is an enemy before the charm, an
  ally during it, and an enemy again after it breaks, so the engine closes the books at each
  boundary instead of picking a side: on the charm it banks what the mob did and what was
  done to it as a finished encounter and wipes its tracking (the same reset a death does,
  for the same reason — one name, two separate lives), and on the break it wipes again so
  the next blow opens a fresh encounter. A charmed mob is dropped from `npcSeeds` and
  `aliveEngaged` so it can't hold a fight open past its kill, and a charm is cleared on the
  pet's death (or a name-shared respawn would inherit it) and on zoning.
  - **Charm flips allegiance, so it cuts both ways.** On a mob it makes them ours; on one of
    *ours* it makes them the enemy. A landing on a key that is already `friendly` is therefore
    the mirror case — the target joins `charmedAway`, which seeds `npc` and is stripped from
    `friendly`, so the damage they now deal the group is counted instead of hidden. (A mob is an
    enemy at the instant its charm lands, which is exactly what separates the two.) Released on
    the wear-off, on their death and on zoning. No occurrence in a 900k-line log yet, but a long
    fight is where it happens.
  - **Ownership** is settled by three sources, strongest first: a pet's own `Master` line
    (which names the charmer outright), then a `cast` paired within **3s**, then the **class
    inference** — the landing *message* identifies the spell, the spell identifies the caster's
    class ([`spells.ts`](../src/parser/spells.ts), from the wiki's `Cast on Other Message`
    field), and `/who` gives us everyone's classes. `<mob> has been charmed` means an Enchanter
    cast it, so a fight holding exactly one Enchanter has exactly one candidate. This is what
    finally names another player's charm, whose cast line is usually not echoed to our log.
  - **With several candidates it still answers, and marks the answer.** Ranking is by evidence,
    not luck: whoever has been *seen casting* a charm this session comes first, then whoever
    cast most recently. The card carries `ownerGuess`, and the UI appends a `?` and italicises
    the name — a blank helps nobody, but a name presented as fact should have been deduced.
  - **A resolved owner is remembered per mob** (`lastCharmOwner`). A charm on a name we are also
    fighting breaks and re-infers constantly, and the re-inference has no landing message to
    work from, so without this the pet reverted to unowned the moment its charm flickered.
    Together these took unattributed pet damage from 250,634 to **129,282** — 76% of charmed-pet
    damage now has an owner — and `Mirad` from absent to 39 rows and 65,153 damage.
  - **Two mobs can wear one name**, and the log keys them the same. A blow between them
    (`A fire giant warrior slashes a fire giant warrior`) proves they are two, since **nothing
    attacks itself**, so the attacker is moved onto a key of its own at that point and the rest
    of the engine treats them as the separate entities they are: the pet earns its own encounter
    row, and our swings at its namesake stop reading as swings at our own pet.
  - **That split does not wait for a charm message**, and a charm is *inferred* when none is
    known — fighting its own kind on our side is the only way this arises. It has to work that
    way round, because the charm is usually already gone by then: our swings at the enemy twin
    hit the shared key and break it long before any same-name blow reveals the pair. A real
    charmed fire giant warrior stayed out of the table for a full minute of fighting its
    namesake until this stopped depending on the flag surviving.
  - Which side of any one blow was the pet is unknowable, so the exchange is credited to it as
    an upper bound and the card is flagged `ambiguous`. Where the log names no charmer — and for
    another player's charm it usually names none, the cast simply not being in our file — the
    row carries no owner rather than a guess.
- **A charm on a name we are also fighting flickers constantly**, so the live flag is a poor test
  of whose side a blow was struck for: our swings at the *other* mobs of that name land on the
  shared key and break it, over and over. `FightState.everCharmed` is the durable record, and it
  is what the encounter tables filter on. The justification is that **nothing hostile has a reason
  to attack another mob** — so damage from a sometimes-charmed key to a mob is pet damage whatever
  the flag said at that instant. A charmed fire giant warrior dealt **36,439 over 609 hits** to
  Lord Nagafen while the table showed none of it.
  - `everCharmed` also decides `kind`, so a combatant is not relabelled several times inside one
    encounter as its charm comes and goes.
  - **`resetNpcTracking` clears a mob's outgoing damage from friendly victims only.** That reset
    exists so a same-named respawn's `taken` on our cards starts at zero, and it fires on every
    re-charm and on every death of anything sharing the name — which was erasing the pet's damage
    to the boss some twenty times over one fight. Damage it dealt to another *mob* is banked in
    that mob's still-running encounter and has to survive. Clearing indiscriminately in the other
    direction is just as wrong: preserving it wholesale made damage taken accumulate across every
    respawn and inflated the session total tenfold.
  - **A charm is still told apart from a summon**, though neither folds into anyone now: a
    charm is temporary, breakable, and often not even ours, so the two need different things
    said about them (`EncounterCard.petKind`, `⛓` against `🐾`). A `Master` line from a charmed
    mob therefore sets the *charm's* owner rather than a `petOwners` entry — filing it as a
    summon would name the wrong owner, and in the twin case would name the enemy's.
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
- **Encounter liveness and the 60s encounter timeout**: a per-NPC pane is *active* only while
  the NPC is un-slain, its owner is alive (enemy pets named `<owner> pet` despawn when the owner
  dies), and it has traded blows within **60s**. That window is separate from the *fight*
  timeout, and shorter: a pull can stay open while one particular mob is left alone.
  - **Zoning terminates every encounter**, from either half of the transition: `LOADING, PLEASE
    WAIT.` as well as `You have entered <zone>.` The two don't pair up one-for-one in a real log
    (110 against 115), so relying on the named one alone let encounters span a transition. Only
    the named half moves the zone, counts a zone change or marks the timeline — the unnamed one
    ends the fight and says nothing about where we now are.
  - **Re-engaging a mob after that window starts a new encounter**, and the abandoned stretch is
    **discarded** rather than banked — it is not a fight, and keeping it would put a fragment in
    the recent list and in every average. Dropping the encounter also keeps its damage out of the
    stance overview for free, since that sums `selfComboLog` inside *encounter* windows.
  - Without this, a boss that hit you once, was left for fourteen minutes and then fought
    properly reported **one** encounter spanning the whole gap, with every rate divided by the
    idle time: a real Lady Vox read 669s at 79 dps where the actual engagement was 391s at 136.
- **Encounters** (the primary view): each mob is a per-character table (one row per player/pet, a %-of-damage bar + DPS/HPS/tank columns, expandable to abilities). `snapshot()` exposes **`activeEncounters`** (mobs currently being fought — live tables at the top) and **`recentEncounters`** (a rolling last-5, newest first). A mob is finalized on death **or on fight close** (zone / 90s / abandon) for a boss you fled. On death the mob's per-encounter tracking is **reset**, so a same-named respawn (`a clay gargoyle`) is a fresh instance rather than merging into one inflated span; fled/closed mobs cap their end to their last combat activity. **Rates are per-person**: each character's active window starts at *their* first contact with the mob (their attack, or the mob first hitting/casting on them — tracked as per-`attacker>target` first-contact timestamps) and runs to the encounter end, so late-joiners aren't diluted. **A pet's window instead closes at its own last contact** — it is the one participant whose leaving the log shows. Per-(target, attacker) damage is kept as full metric accumulators.
- **Per-encounter sparkline.** `selfHits` keeps my damage to each target timestamped — which
  `selfComboLog` cannot answer, since it is per-*session*, not per-mob, and would blend two mobs fought
  at once into one strip that disagreed with the row above it. `encounterView` buckets it into
  `selfSpark`: a dps per bucket over the encounter's span, buckets never under a second (the log's own
  resolution) and never more than **40** of them, widening instead. Leading zeros are real information —
  they are the seconds the mob was up before I engaged, the same gap the row's `time` column reports as
  a number. Dropped with the mob's other tracking in `resetNpcTracking`, so a respawn starts empty.
- **An encounter card's `taken` ships no ability list.** Only `damage` opens a per-ability drill;
  the tank column is a total. The breakdown behind it was 2.8KB of a 26KB card payload on a raid
  pull, re-sent ~5/sec and never rendered. `entries: []` there means *not sent*, not *nothing
  landed* — the totals and rates are whole, and a test pins it so nobody "fixes" the empty array.
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
- **The My DPS panel counts the fight in progress**, not only finished encounters. Both the
  stance overview and the history chart merge the live encounters' spans in alongside the
  finished ones. Without that the panel reports the combo you were in when the last mob *died*:
  on a long fight that is minutes stale, and after a stance change it simply disagrees with the
  stance pill in the topbar. It got much more visible once encounters stopped spanning idle time
  — the windows narrowed by ~30% and combos started dropping out of the 10/25 chips entirely.
  - A live encounter earns a **chart bar** only once it has ≥5s behind it: a rate over one or
    two seconds is mostly noise, and since each half of the chart is scaled to its own peak, a
    single early crit would rescale every other bar on the way past. The *overview* has no such
    threshold — seconds in a combo are seconds however few.
  - Both caches are therefore bypassed while a fight is open, since the window moves on every
    blow. Measured at **0.58ms** per `snapshot()` against ~5 pushes/sec, versus a panel that
    contradicts the topbar.
- **Self encounter history**: `snapshot().encounterHistory` is the last **50** encounters seen from my side — my total damage and damage taken, **each also as a rate over the encounter's own length** (`dps`, `takenPerSec`), its start/end and duration, and the **dominant stance combo** (the combo I spent the most seconds in over the encounter's window, via `dominantComboIn` → `comboSecondsIn`). Cached next to `overviewCache` and invalidated on the same event (a new finished encounter). This is what the overview's history chart plots; `recentEncounters` stays at 5 because it carries full per-combatant tables.
- **Progression** splits by frequency, because the two halves are used differently:
  - **`milestones`** — the rare, *markable* kinds only (`level`, `ap`, `ability`, `death`, `zone`),
    chronological, each with a short label and a full-sentence `detail`. These become glyphs on the
    chart's timeline, so the list stays small enough to ship in every SSE snapshot.
  - **`progressLog`** — skill-ups and xp ticks. There are thousands of them in a session (~5k skill-ups
    in a 460k-line log), so they are never marked; they only feed counters.
  - Both are trimmed with the combo logs when an encounter ages out, and `progressWindows` reduces
    them to per-window totals over the same 10/25/50 slices the stance overview uses — cached and
    invalidated on the same events. `progress` carries the latest level + unspent AA.
  - A `Progress` event never opens, extends, or closes a fight; it only annotates the timeline.
    A level-up fires immediately after a kill, so it lands on the boundary *between* two encounters.
- **Mote tracking keeps two windows, because the two readings want different ones.** The
  difficulty grid wants the last **250 loots whatever their tier**; each tier's gap wants that
  tier's own last **10**. A shared window can't serve both — a rare tier would fall out of a
  250-loot window entirely and never show a rate at all.
  - **250, not 100**, because the grid's job is showing which difficulty feeds which tier. At 100
    the rarer rungs were down to two or three cells and the shape read as noise; the window is
    sized to the *sparsest* row that still has to be legible, not the densest.
  - The gap is a **mean over the last 10 drops of that tier**, so moving somewhere better shows
    up quickly, and it is withheld below 5 drops: three drops of a rare tier is not a rate, and
    printing one invites reading it as one. The sample count shows instead.
  - Difficulty comes from the zone name's suffix at the moment of the drop
    ([`motes.ts`](../src/parser/motes.ts)). A drop before the first zone line has **no** known
    difficulty — counted apart rather than folded into D0, which would be a different claim.
  - **The eight most recent drops come off the same 250-entry buffer**, not a second log — it
    already carries the corpse and the zone per drop, so the recent list is a `slice(-5)` of it.
  - **The tab is one row per tier**: identity and recency on the left (last / from / gap), the
    difficulty distribution on the right. It was two stacked tables sharing a tier column, which
    left the upper one mostly whitespace and made comparing a tier's rate against where it drops
    a matter of matching names across a gap.
    - **The D0–D4 labels live in the UI, not the parser.** `web/` imports nothing from `src/` —
      the same boundary that makes the types mirrored — so `motes.ts` owns the *contract* (a
      difficulty is 0–4, or null) and the UI owns how it is spelled.
    - **A trailing `all` column sums the row's own difficulty cells**, so a line's arithmetic is
      checkable and the bottom row's grand total lands on the window size. It is deliberately not
      the count beside the tier name: that one is every drop ever seen, this one is the window the
      split is drawn from, and on a real log they differ (Minor: 109 all-time against 77 in the
      last 250). Left unshaded — it is a sum, not a share, so a heat ramp would invite comparing
      it against the cells it is made of.
    - **Each row is shaded against its own maximum**, not the table's. The question a row asks is
      "where does this tier come from"; a table-wide scale would flatten every rare tier into one
      pale line — Major has nine drops against Minor's hundred and would simply vanish. Per-row
      normalisation is what makes the diagonal (low tiers from D0, high tiers from D3/D4) visible
      at a glance.
- **Long-term counters are snapshots, not scans.** `kills`, `zones` and `combatMs` run as
  monotonic session totals; when a level or an ability point lands, the engine records the
  totals *at that moment* as an **anchor**. Every figure the stats boxes show is then a
  subtraction of two anchors — O(1), and immune to `milestones` being trimmed as encounters age
  out, which would otherwise delete the anchor exactly when the stretch it measures got long
  enough to be interesting.
  - **A span is the gap between consecutive anchors**, labelled by the milestone that *ended*
    it, so a row reads as "level 44 cost 175 kills and 1h 29m" rather than "everything since
    level 44". The head of each list is the still-open stretch. Keeping N spans therefore needs
    **N+1 anchors** — the oldest exists only to be the start of the oldest span, and the span
    that would have no predecessor is dropped rather than printed as a total wearing a delta's
    label. Shown: **2 levels**, **4 ability points**.
  - Combat time sums **fight** spans, not encounter spans: fights never overlap, so their
    seconds are real clock time, where two mobs at once would have counted a second twice.
  - **Zone stance split** clips the stance segments to "since I last entered this zone", with
    the window ending at wall-clock rather than the last blow — time spent standing in a stance
    between pulls is still time in that stance, and that is exactly when you'd be reading it.
    The open segment has to be clipped in too, or a stance you never changed reads as zero.
- **"What killed me" needs no new parsing** — every field was already in the event stream, just
  never kept together. A rolling window of incoming hits (`selfBlows`) carries the attacker and
  ability that `selfTakenComboLog` and `selfTaken` both drop, alongside the heals that landed on
  me; on my death it is folded into a `DeathReport`. Trimmed to the window on every write, so it
  stays a few dozen entries rather than a session-length history.
  - **The window is fixed at 10s, and that is a limitation, not a choice.** "Since I was last at
    full" is the question worth asking and the log makes it unanswerable: hit points are never
    stated. Ten seconds covers the burst that actually kills — on a real death, four attackers, a
    209-damage nuke, a DoT tick and a damage shield all landed in the last three.
  - Verified against the raw log: the Najena death reports 723 damage taken, and a grep of every
    incoming-damage form over the same ten seconds also sums to 723.
  - **The blow-by-blow does not ride the push.** The panel reads the *last* blow and the two
    rankings, which the engine already derives at the moment of death — so `DeathReport` carries
    `killingBlow` and the full array stays in the engine (`deathBlows`, trimmed with `deaths`).
    It had been **21KB of a 25KB section**, the largest thing in the snapshot, re-sent ~5/sec for
    one element. Kept rather than dropped because `selfBlows` is trimmed to the window: a report
    is the only surviving record of a death's detail, and 5 × ~50 blows is ~20KB of heap.
- **A friendly death ends nothing.** Only an NPC's death finalizes an encounter and resets its
  tracking; doing that for a player would erase the corpse's damage from every mob still being
  fought — which is precisely the run you want to keep looking at.
- **Aggregation** per fight → per combatant:
  - totals, DPS (damage ÷ active-seconds), % of fight, hit/crit/miss counts;
  - **damage-by-type** (melee / spell / DoT) for drill-down;
  - **per-ability breakdown** (verb for melee, real spell name from DoT/spell lines);
  - **damage-by-stance** and a per-fight stance split (self).
- **The critical-hit ledger is self-only, and windowed.** It keeps two halves, because they answer
  different questions and have different lifetimes:
  - **All-time accumulators** — five categories, each a small map of the abilities used. O(1) per
    hit and a fixed size regardless of session length. These feed the **records badges**, and they
    are what makes those records survive the retention trim below: a personal best from three
    weeks ago must not quietly disappear.
  - **A per-hit log** (`critLog`), one entry per self landing, from which any window is rebuilt.
    ~309,000 entries over a 2M-line log, trimmed to `CRIT_RETAIN_DAYS` (14) — the longest window
    offered, so nothing retained is unreachable and nothing reachable is missing. Costs **31MB**
    (54MB heap → 85MB after a full replay) and nothing measurable on the hot path: replay is
    14.9s against a 15.0s baseline.
    - Entries are flat and numeric, holding **indices into a shared name table** rather than
      strings — for the ability *and* the target, since a window's best crit still has to name
      what it landed on.
    - Each carries the **encounter counter** (`encounterSeq`) as it stood when the hit landed.
      That is what makes "the last 25 encounters" a comparison against a number rather than a walk
      through retained encounters — of which the engine keeps 60, well short of the 100 the widest
      encounter window asks for.
  - **The four windows**: `session` (since the last login, capped at 12h), `enc25`, `enc100`,
    `d14`. Their arithmetic goes through the **same `addCritHit`** the live path uses — it now runs
    twice over the same hits, and two copies of "what counts as a crit" is exactly the duplicated
    rule past audits here keep finding.
  - **"The last N encounters" walks the stamps rather than subtracting from the counter.**
    Subtracting is off by one the moment no fight is in progress, which is most of the time — it
    reported 24 encounters for a 25-encounter window, and the test that caught it is kept. Walking
    also gives the honest meaning: **encounters I fought in**, since one stood through without
    swinging leaves no entry to count either way.
  - **A window reports what it actually covered** (`fromMs`/`toMs`/`encounters`) and sets `short`
    when the log does not reach back as far as the label promises, so 12 fights are never read
    as 100.
  - **Both keys rise along the log, so one binary search finds a window's start on either axis.**
    Filtering the encounter windows inside the loop instead meant walking all 309,000 entries to
    reach the last 25: 6.4ms to read 825 hits, now 0.16ms. Lowercasing the ability name per entry
    was the other 40% of a rebuild, so the name table carries a lowercased copy alongside.
  - **Cached on the log's length and the minute**, which serves the idle case exactly as the stance
    overview's cache does: while you are fighting every hit invalidates it, and while you are not,
    the panel's 4s poll costs nothing. That is the case worth covering — `d14` walks everything for
    16ms, and the person parked on the two-week view is the person who has stopped swinging.
  - **Validated against the raw log**, not just the tests: the session window's bounds were taken
    from the engine and every figure inside them re-counted from the raw lines — melee 910 hits /
    107 crits / 131,334 damage, spells 105/0, DoT 307/24, heals 740/0, procs 0/0. All five exact
    on all three figures.
  - **Only my own blows.** A pet's swings are its crits, not mine — its rate would quietly move
    a number the panel presents as a fact about this character. This was already the rule while
    the meters still folded pet damage into my row; the meters now agree with it. Recorded inside the existing `aKey === selfKey` branch of
    `recordDamage`, so it costs no extra test on the hot path.
  - **Its five categories are not `DamageType`.** They split by *what can crit and how often*,
    which is a different question with a surprising answer: `melee`, `spell` (named abilities),
    `dot`, `heal`, and **`proc`** — the `non-melee` line form, every proc and damage shield in the
    game, which has **never once carried a crit flag** in a 2M-line log. That is why
    `SpellDamageEvent` now carries a `form` (`ability` | `nonmelee`): folded together, the two
    forms divide 5 crits by 55,000 hits and call the answer a spell crit rate. Kept apart, the
    spell rate divides by the 15,528 named-ability hits that could actually have critted, and the
    proc row reports "cannot crit" instead.
    - **That last claim is left to the evidence, not asserted.** `crittable` is `true` for the
      four flagged forms and, for `proc`, is simply whether any crit has ever been seen. 39,563
      hits produced none, so the panel says so on the strength of the count — and the day one of
      them does crit, the row starts reporting a rate rather than arguing with the log.
  - **Heals are counted before the fight guard**, unlike every other heal figure. A heal cast
    between pulls is still a heal that critted or didn't, and the ledger is session-wide rather
    than fight-scoped — so its denominator is every heal I cast, which is also what a grep of the
    log counts. (Verified: 42,626 either way.)
  - **A record keeps the first of a tie**, so a best that has stood all session isn't restamped by
    a later hit of the same size — this character's best melee crit is 629 and has landed three
    times.
  - **Two records per category, because the hardest hit is not always a crit.** `best` is the
    biggest crit; `bestHit` is the biggest hit of any kind, tracked before the crit test and
    carrying `kind: null` when it wasn't one. Usually they are the same hit — but this character's
    biggest spell hit is a **647 Denon's Desperate Dirge that never critted**, against a biggest
    spell *crit* of 220, and its biggest heal is a 6,253 Lay on Hands X that likewise didn't. A
    records board holding only crits would report 220 and read as broken to anyone who watched the
    647 land. Verified against the raw log per category: melee 629, spell 647, DoT 201, heal 6,253,
    proc 26 — all exact.
  - Costs nothing measurable: full-log replay is 14.7s against a 15.0s baseline (noise), and
    `snapshot()` goes 0.081ms → 0.088ms for the rebuild, at ~5 pushes/sec. No cache needed.
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
  - `POST /api/shutdown` → stop the process. **Requires `Content-Type: application/json`**, which
    is the whole guard: this server answers no CORS headers, so demanding a non-simple content type
    forces a preflight that never comes back — without it, any page you happened to be visiting
    could stop your parser with a no-preflight form post at localhost. `charset` is tolerated,
    since that is what `fetch` actually sends. Tests cover the refusals as well as the acceptance:
    a guard that returns 415 while still stopping the server would be theatre.
  - `GET  /api/browse?dir=` → directories inside `dir`, each with its `eqlog_*.txt` count, plus the
    parent and the platform's shortcuts. Omit `dir` to open wherever the app is already pointed.
    **The browser cannot do this itself**: `showDirectoryPicker()` returns an opaque handle and
    `<input webkitdirectory>` returns paths relative to the chosen folder — both withhold the
    absolute path on purpose, and the absolute path is the only thing the backend can act on. So
    the listing happens here. The server already binds to 127.0.0.1 and exists to read this
    machine's disk, so this adds no reach it did not have.
  - `GET  /api/sky-quests` → the Plane of Sky catalogue, `Cache-Control: max-age=3600`. **The one
    thing that is fetched rather than pushed**: 28KB of data that cannot change while the process
    runs, where folding it into the snapshot would add a third to every push and say nothing new.
    The snapshot carries only the have-state it is joined against.
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

interface DeathReport {               // "what killed me", built at the moment of death
  killer: string; tsMs: number;
  windowSec: number;                  // fixed: the log never states hit points
  totalTaken: number; healed: number; // damage in, healing in, over that window
  killingBlow: DeathBlow | null;      // the last hit to land; the blow-by-blow stays server-side
  byAttacker: { name: string; total: number }[];
  byAbility: { name: string; total: number; damageType: DamageType }[];
  melee: string; invocation: string;  // the stance combo I died in
}

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
  progress: { level: number | null; aaUnspent: number | null };
  deaths: DeathReport[];              // last 5, newest first
  stats: LongTermStats;               // since-level / since-AA counters + zone stance split
  sky: SkyStats;                      // Plane of Sky: what is held, not what is needed
}

interface SkyStats {                  // the tracker's dynamic half; the catalogue is fetched
  inventoryPath: string | null;       // the export the baseline came from, null if never written
  inventoryMs: number | null;         // its mtime — the cut-off the log takes over from
  inventoryItems: number;
  held: SkyHolding[];                 // { name, count, source: inventory | loot | both }
  recentLoot: SkyLoot[];              // Sky pickups after the cut-off, newest first
  completed: SkyCompletion[];         // { reward, tsMs } — turn-ins the log witnessed, newest first
}

interface EncounterView {             // one per-mob card
  name: string; active: boolean; durationSec: number;
  total: number; dps: number;         // whole encounter: damage dealt to the mob, and the combined rate
  npcDamage: MetricStat;              // what the mob dealt back, over the same span
  selfSpark: number[];                // my dps per bucket across the span
  selfTakenSpark: number[];           // what the mob dealt me, on the same buckets
  mobTakenSpark: number[];            // everything the *group* dealt it, same buckets
  mobDealtSpark: number[];            // everything it dealt the group
  sparkCombos: string[];              // "melee|invocation" holding the most of each bucket
  sparkBucketSec: number;             // seconds each bucket covers (>= 1)
  cards: EncounterCard[];
}

interface EncounterCard {             // one row of that card
  name: string; kind: "self" | "player" | "pet"; isSelf: boolean;
  petKind?: "summoned" | "charmed";   // which sort of pet — neither folds into anybody
  ownerName?: string;                 // the summoner, or the charmer when one is known
  ambiguous?: boolean;                // charmed mob sharing its target's name: figures are the pair's exchange
  pct: number;                        // share of damage dealt to the mob (the bar)
  activeSec: number;                  // their engaged window — what all three rates divide by
  startedSec: number;                 // where that window opens inside the encounter
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
- **Folder picker** ([`FolderPicker.tsx`](../web/src/FolderPicker.tsx)) — a **Browse…** button beside
  the path box, opening a server-backed directory browser rather than a native dialog (see
  `/api/browse` for why a browser-side chooser cannot work here).
  - **Every row carries its log count**, which is the whole point: you are hunting for the one
    folder holding `eqlog_*.txt`, and being *told* which one beats recognising the name. It earns
    its keep immediately — this install's folder is called `Logs`, not `logs`. Only folders with
    logs are given weight, and the confirm button turns primary only when the current folder has
    some. Costs one `readdir` per subdirectory, ~47ms on the 6,156-entry install folder, capped at
    100 subdirectories so it stays bounded rather than merely fast in practice.
  - **It opens where the app is already pointed**, so the common case is confirming, not hunting;
    shortcuts cover the platform's expected install and home, and are only offered when they exist.
    A start folder that has gone missing is skipped rather than opened on, so a first run never
    greets you with an error — but a folder you *asked* for is still reported missing, since a
    mistyped path silently redirecting would look like it had worked.
  - **On Windows the shortcuts also list the drives, and that is load-bearing.** Windows has no
    single filesystem root — `path.dirname("C:\")` is `C:\` — so a picker that only walks *up*
    can never leave the drive it opened on. A game installed on `D:` would be unreachable except
    by typing the path, which is the thing the picker exists to avoid. The 26-letter probe is
    win32-only and cached for the process, since drives do not come and go mid-session and a
    mapped network drive would make the stat far from free.
  - Symlinked directories are followed, because `Dirent.isDirectory()` is false for them and a
    Wine bottle is often laid out that way — skipping them would hide the install.
  - The path bar truncates in the **middle**: the last segment answers "where am I" and never
    shrinks. `direction: rtl` is the usual one-line trick for this and is wrong on paths — it
    treats the leading `/` as neutral and reorders it to the far end, rendering `/Users/…` as
    `…/` with a slash that is not in the path.
  - The list is split from the fetching (`FolderList` / `FolderPicker`) so it can be rendered from
    a fixed listing — the live app holds an SSE connection open, and headless Chrome never reaches
    a settled state to photograph.
- **Live pane** — the My DPS panel, then the active encounters, then the last five, all auto-updating.
  Deliberately **unfiltered**: the per-NPC encounter tables replaced the single filtered fight meter this
  pane originally held, and a 540px column has no room for chips that only ever hid rows. The
  combatant-kind filter survives in the **History pane**, where a fight's full roster is the point; the
  by-damage-type and by-stance filters of the original M4 design were never rebuilt after the encounter
  redesign, and the drill-downs (type split, per-ability, stance split) answer those questions instead.
  A live stance indicator in the topbar shows the active melee stance and invocation.
- **History pane** — fight list; select a fight to **drill down**: per-combatant rows → expand to damage-type split, per-ability breakdown, and (for self) the stance split active during that fight.
- **Crits pane** ([`crits.tsx`](../web/src/crits.tsx)) — one question asked five ways: **of the
  times I dealt damage, how often did it crit**, and when it did, how hard. Its arithmetic lives in
  [`stats.ts`](../web/src/stats.ts), apart from the panel that draws it, for the same reason as the
  Sky model: these are exactly the rules that regress quietly into the wrong denominator.
  - **Four windows**, narrowest first so moving right reaches further back: session, 25 fights,
    100 fights, 2 weeks. The choice is remembered in `localStorage`, like the Sky tab's class.
    - **Fetched from `/api/crits`, not pushed.** The four together weigh about as much as the whole
      snapshot, which goes out ~5/sec — too much for tables one tab reads. Polled every 4s while
      that tab is mounted instead, which a rate over 100 fights cannot outrun; the badges and the
      recent-crits strip ride the snapshot, so the genuinely live half of the panel stays live.
      - **The figures live here and nowhere else** — measured 2026-08-06 at **54KB against a 75KB
        snapshot**. The same sentence had been restated in six files with the numbers drifting
        apart in each (two already disagreed, and all were ~25% stale), so the copies now give the
        reason and this is the only place with a number in it. The ratio is the durable part.
    - **The strip prints what the window turned out to cover**, not what its label promised —
      "76 min · since Aug 4, 11:21 PM · 26 fights" — and appends *all there is* when the log
      cannot reach back far enough.
    - An older server with no such route says so, rather than rendering an empty table that reads
      as "you have never critted".
  - **A records board leads the tab** — biggest melee, spell and DoT crit, each with what did it,
    to whom and when. It sits above the rates because it is the one thing here read at a glance
    and the one thing that does not move on most pulls. Since the engine replays the whole log on
    start, these are records over the **active log**, not just the current sitting.
    - **Each tile also prints the outright record when it is a different hit**, marked *not a
      crit* — the 647 case above. Without it the spell tile says 220 and looks wrong.
    - **The badges sit outside the window selector entirely.** "Highest ever" is the one reading
      on this tab that must not move when the window does.
    - Heals and procs have records too and keep them on their own rows, where a healing number
      cannot be mistaken for a damage one.
  - **Four figures per category, in a fixed strip**, so the eye can run down the crit-rate column
    across all five rows — comparing melee to DoT is the reason the tab exists. Rate, crits/hits,
    the *share of damage* that arrived on a crit, and the multiplier against an ordinary hit. The
    first two are not the same reading: a melee crit lands on 8.35% of swings and carries 12.5% of
    the damage, and only the pair says that.
  - **A missing rate and a zero rate are drawn differently.** `crittable: false` prints `—`, not
    `0.0%`, because "this form cannot crit" and "this rolled badly all session" are different
    answers to the same question and must not look alike.
  - **Thin samples are marked, not hidden**, in amber with a `?` — the number is still the best
    answer available, it just should not be read as settled. Two thresholds, because the two kinds
    of figure have different denominators: `THIN_SAMPLE` (100 hits) governs the *rate*, and
    `THIN_CRITS` (20 crits) governs the share and the multiplier, which divide by crits alone.
    Real case: 15,581 spell casts is a solid denominator for a 0.03% rate, and the five crits
    behind "0.90× a normal hit" are a solid denominator for nothing.
  - **The per-ability table shows anything that has ever critted, plus anything used 100+ times**,
    so a spell cast 599 times without a single crit keeps its row — that absence is the finding.
    Its "biggest" column is a bar against the *category's* best rather than each row's own, which
    is what makes "my best kick is two-thirds of my best slash" legible without dividing.
  - Categories reuse the meters' `--melee`/`--spell`/`--dot` colours deliberately: a reader who has
    learned them on an encounter card should not have to learn a second set here.
- **Sky pane** ([`sky.tsx`](../web/src/sky.tsx)) — the Plane of Sky class quests, in **two views
  over the same data**, because the tab answers two questions that want opposite arrangements and
  neither is a filter of the other. The arithmetic behind both lives in
  [`sky-model.ts`](../web/src/sky-model.ts), apart from the panel that draws it — the same split
  as `stats.ts` against `components.tsx`, and for the same reason: these rules are worth testing
  without a renderer.
  - **By class** — "how far along is my Bard", the catalogue's own shape. 95 quests over 16
    classes is not a table anyone reads at 540px, so the 16 three-letter codes are a chip row and
    the body is that class's quests. Each quest is a small block — a header carrying its state,
    then one row per rune, component and reward — because a row of item names means nothing
    detached from its quest.
  - **A box above both**, for what is actionable now and what has just been finished. The two
    belong together because they are one story a step apart: a quest goes *ready*, you walk to
    the NPC, it becomes *complete*. Ready is derived from what is held; complete is an **event**
    (`You have been given:`), which is why a quest finished before this log begins is still ✓ in
    the class view but is not listed here — that is what "recently" means. The box renders
    nothing when there is neither.
    - **The completed half is capped at `RECENT_COMPLETIONS` (10), newest first.** A real log had
      36 turn-ins in it, and every row pushed the *actionable* half — what is ready to hand in —
      further down the panel, which is the one thing in the box you act on. What the cap holds
      back is said outright ("+26 earlier") rather than silently dropped, and the badge counts the
      rows beneath it rather than every turn-in ever: the same rule the mote list follows, because
      a number above a shorter list reads as a bug.
    - **The cap is display-only, and it has to be.** The same `completed` array feeds
      `completedQuestNames`, which is what marks a quest ✓ across the class and island views.
      Capping what reaches *that* would un-finish every turn-in past the tenth — quests already
      handed in would read as ready again, sending you back to an NPC with nothing left for you.
      A test pins exactly this, because it is invisible in the capped list itself.
    - The "+N earlier" count comes from the resolved list, not the raw array: a handover that is
      no quest reward (a real log has three `You have been given: Void-Touched Potential`) was
      never going to be listed, so counting it as held back would overstate what is hidden.
  - **By island** — "I am standing on Island 5, what do I look for". Every outstanding component
    across all 16 classes, grouped by where it drops and **sorted most-wanted first**, so the item
    two classes need is the one you learn to recognise. Three things are left out, each a rule
    rather than a tidy-up: components of a **finished** quest (the turn-in consumed them, and
    listing them sends you farming for a reward already in the bag), components **held in
    sufficient number** — and sufficient counts the *quests* that want it, not one, because a
    turn-in consumes the item and 14 components are wanted twice.
    - **Settled components stay on their island, sorted to the foot of it.** An earlier cut
      dropped a component the moment it was answered, which kept the list to a plan but made an
      island unreadable as a *place*: "Island 5 wants nothing more from me" and "Island 5 was
      never in this list" rendered identically. They are now kept, dimmed, under a `have / turned
      in` heading, and the island header carries both figures (`13 +1`). Deliberately **not**
      grouped by mob — that heading answers "where would I farm this", the one question these
      rows do not raise.
    - Three states, separated by counting only the **unfinished** quests that want an item, since
      a turn-in consumes its components: `done` (none left wanting it), `held` (enough in hand for
      those that do), `needed` (short). Finishing one of two quests sharing a component therefore
      drops what it asks for from two to one.
    - **Runes get a group of their own, sorted first.** They were once left out entirely, on the
      belief that the quest giver handed them over. The wiki says otherwise — they "drop from all
      mobs in the Plane of Sky" — so they are farmed like everything else, and filing them under
      any one island would be a claim it contradicts. They lead the list because they are what you
      can farm while doing anything, and because a rune is wanted by **six or seven quests on
      average**: the biggest single thing to collect, not a footnote.
    - **Outstanding means "an unfinished quest still wants it", not "you are short of it".** Holding
    a component is not being finished with it — the turn-in has still to happen — so a held row
    stays in the list under its mob instead of dropping into the settled block. It had been landing
    in a group headed *"have / turned in"*, which reads as done: on the real inventory **30 rows**
    were sitting there while a quest was still asking for them. Only genuinely finished rows are
    settled now, and that heading is plain **"turned in"**.
    - **Farming and handing in are different jobs**, so the two are still told apart rather than
      merged. `state` keeps its three values; within each mob group `needed` sorts above `held`,
      because the heading is the mob that drops it and a row in your bags is no reason to go there.
      A held row is dimmed a little and keeps its green ✓.
    - **Counted apart, in the order the work happens**: `needCount` (still to find) `+heldCount`
      (in hand, still owed — amber, the same "qualifies the number beside it" job `--partial` does
      in the encounter table) `+settledCount` (done — green). `needCount` deliberately excludes the
      held rows, or the headline stops being a to-do list.
    - **The count column reads `held/need`** for anything still wanted. `×2` alone answered "how
      many are in my bags", which is the wrong question once the row is in the needs group: `2/1`
      says you hold two and one more turn-in wants one.
  - **Rows sit under the mob that drops them**, because you kill mobs, not islands — and on a
      real island one boss owes you nearly everything (The Spiroc Lord holds 13 of Island 5's 16,
      Sister of the Spire 15 of Island 7's 16). The wiki lists several mobs per item in no fixed
      order, so grouping on the whole string fragments one boss across several headings: the
      Efreeti items alone spread over eight variants of "Noble Dojorn, …". The **first** named is
      taken as the primary source, with a trailing parenthetical dropped so `Bazzt Zzzt (Island 6
      Boss)` files with `Bazzt Zzzt`; the full list stays in the tooltip. Mobs are ordered by how
      much they owe you, and the unsourced group sorts last — a path no data reaches since the
      second source closed the last of the 25 gaps, kept because "we don't know" stays a possible
      answer whenever either source changes.
    - **The Efreeti cycle is one heading, not one per mob** (`EFREETI_MOBS` — `Dojorn / Overseer /
      Hand`). First-named grouping is the right rule on an island, where which boss to kill is a
      choice; the cycle is not a choice. All 19 of its rows now name the same three mobs, but three
      of them in a different order — so first-named would *still* split the cycle across a "Noble
      Dojorn" heading and a "The Hand of Veeshan" one, for a distinction that means nothing on the
      ground. The heading is literally accurate for every row under it.
    - **`EFREETI_CYCLE` replaces "No island listed".** An untagged item is not a gap in the wiki's
      data: those items are not *on* an island. The old label described the table it came from, the
      new one describes where you go. It still sorts last, and `IslandNeeds.island` is now a plain
      `string` — the null was only ever standing in for this name.
  - **State is derived from what is held, in four steps**: `done` (every reward held — *every*,
    since Beastlord's Test of Claw awards a weapon per hand), `ready` (all components, nothing to
    farm), `partial`, `open`. Carried by a coloured left border and a glyph, so a class's shape is
    legible without reading a number on each row.
  - **The baseline strip is not decoration.** "I don't have it" and "nothing has told me what you
    have" render identically as a row of dashes, and only one of the two is fixed by playing — so
    the export's name, item count and read-time sit above the table, and its absence is replaced
    by the `/outputfile inventory` instruction that fixes it.
  - **The rune is a component, and counting it is what makes "ready" mean anything.** It was
    treated as a formality — a thing the giver would produce on request — so `progressOf` left it
    out of the tally and any quest whose *other* items were in the bag reported itself ready to
    turn in. Against a real inventory that overstated readiness by nearly half: 13 quests claimed
    ready, 7 actually were, and the six differences were each exactly one rune short.
  - **A held rune is labelled `rune`, never "started".** The 15 runes are shared across the 16
    classes, so holding Wind Rune Neza could be for this quest or one of the five others that
    also want it; held is all that can honestly be claimed.
  - **Per-quest readiness is deliberately local.** It asks "is this in the bag", not "is there
    enough to go round" — you really can turn this one in now. The aggregate lives in the rune
    group, where `1/7` says the bag holds one and seven quests want one each.
  - **Counts are printed, never spelled.** Runes stack into a single slot with a quantity beside
    them, and several classes want the same rune, so a row saying "have" hid the only figure that
    answers whether one covers one quest or three. Every held row shows `×N`.
  - **The lists are responsive grids**, which is a departure from the rest of the app. Everything
    else is built for a ~540px side panel where one column is the only option; this is the tab
    people open wide, and past ~800px a single column stopped adding information and started
    adding distance — an item name at the left edge and its count pinned 400px away. Quest
    blocks, islands and the pickup list all use `repeat(auto-fit, minmax(300px, 1fr))`, so they
    collapse to that one column below ~640px and nothing is lost at panel width. `auto-fit`, not
    `auto-fill`, for the reason the stance tiles found: with two quests left over, `auto-fill`
    holds open empty tracks and strands half the width. A quest never splits across columns.
  - The selected class is remembered in `localStorage` — the same courtesy the log picker extends.
- **Encounter header** — `<mob> → <n> dps · ENCOUNTER <dur>s · <total> dmg · <n> dps`. The right-hand
  figures are the **whole encounter** (everyone's damage to the mob, and the combined rate against it),
  labelled `encounter` precisely because the rows beneath are per-person and would otherwise be
  mistaken for the same thing; the `title` spells that out. The red figure by the name is what the mob
  is **dealing out** to everyone it fought — the same red the `tank` column uses for damage from mobs.
  It is hidden entirely for a mob that never landed a hit, rather than printing a zero.
- **The encounter timeline is two charts over one shared time axis**, in a band of its own
  between the header and the table, each taking half the width.
  - **Left is me**, on the My DPS chart's grammar: my damage above a baseline, what the mob dealt
    me below. Bars take the colour of the **stance combo** I was in for that bucket, so a
    mid-fight stance change reads as a change of colour.
  - **Right is the mob, and deliberately not filtered to me**: everything the whole group dealt
    it above, everything it dealt the whole group below. Side by side the pair answers what
    neither half can alone — whether a lull was the mob surviving, the group stopping, or *me*
    dropping out while everyone else kept going. Both use the same buckets, so they read across.
  - Each half of each chart is normalised to **its own peak**, because incoming and outgoing
    routinely differ by an order of magnitude and one scale would flatten the other. Damage
    *out of* a mob is one colour on both charts: it is the mob's doing, not a stance of mine.
  - **The group chart is deliberately neutral (`--s-other`).** Colour there encodes nothing — it
    is one series, not six — so it must not compete with the stance palette beside it.
    `--player`'s green was tried and collides head-on with `--s3` and `--s6`, which are also
    greens: two of the six stance slots made the two charts read as the same series.
  - **A rule with a notch separates them.** Whitespace alone read as one wide chart with a
    stutter in it, which is the one reading that is actively wrong — the halves share a time axis
    and nothing else, and no bar on the left belongs to the series on the right. The notch sits
    at the divergence height, tying the two baselines together.
  - Each chart's `title` spells out the axes, because none of it is guessable from the bars: that
    height is a **rate** rather than a total, that the two halves are scaled separately, and that
    the line is zero rather than a floor. The rule between them carries the shared-axis reading.
  - **It does not overlap the table, and that was learned the hard way.** "Fill the card" was
    first taken literally — drawn over the rows at 19% opacity. Bars running across every number
    made the table hard to read, which is the opposite of what a chart beside a table is for.
    (Behind the rows is worse still: they carry their own backgrounds, so the timeline survives
    only in the gaps between columns and reads as scattered blocks.)
  - Heights are in **px** like the history chart's — 26 up, 14 down — so shrinking the type never
    costs the bars their resolution. The `me`/`everyone` labels sit *over* the sparse top-left of
    their own chart rather than taking a row of their own.
  - **The colour map is shared with the My DPS chart**, or the swatches stop working as a legend
    for either. It also takes the timelines' own per-bucket combos as a third source: a timeline
    resolves the combo per *bucket*, so it routinely holds one that is neither any encounter's
    dominant combo nor a row in the overview — on a real boss fight that left 20 of 74 buckets
    on the neutral fallback. They are added last, so slots the two charts already agreed on
    never shift.
  - Hidden below four buckets or when nothing landed either way, rather than drawing an empty
    axis. Leading empty buckets are still real information — the seconds the mob was up before I
    engaged, which the row's `time` column reports as a number.
- **A `time` column ends each encounter row** — the seconds that character was engaged with this mob
  (`EncounterCard.activeSec`, their first contact → the encounter's end). It is precisely the
  denominator of their `dps`/`hps`/`tank` on the same row, which is what makes a 3-second visitor's
  headline rate readable instead of suspicious. It stays deliberately quiet: everyone starts a second
  or two after the mob is first seen, so the accent fires only below **70%** of the encounter —
  otherwise every row lights up and the flag stops meaning anything.
- **Every pet gets its own row**, summoned as well as charmed. Nothing folds into anybody.
  - A summoned pet used to collapse into its owner, which made the owner's dps a figure **no log
    line supports** and put the two halves of one panel at odds: the sparkline beside the table is
    built from `selfHits`, which is my swings alone, so my bar and my row disagreed by the whole of
    the pet's output. The crit tracker had *always* excluded pet swings ("its crits, not mine"), so
    the fold was already the odd one out.
  - It was not a rounding difference. In a real bandit pull the pet dealt **117 of the 175** damage
    — **66.9%** — and the old row presented all 175 as mine. Its `taken` went the same way: 134
    points of tanking the pet did, credited to me.
  - A pet also has **its own window**, and it is the only participant whose window has a real
    **end**. Everyone else's runs to the encounter's close because they are still standing there;
    a pet is summoned into a fight and dies inside it, and the log shows both. So a pet's window
    is **first contact to last contact with that mob** (`FightState.pairLast`), never past the
    encounter's end — dividing by the whole encounter answered "what did it average over a fight
    it spent half of dead", which is a question nobody asks.
    - Measured over the pet-era stretch of the real log, **9 of 13 pet rows read differently**
      than they would over the whole encounter. The extreme: a pet summoned **18s into a 24s
      fight** that fought for 5 seconds — 6 dps on its own clock against 1 over the encounter.
      Both ends of two such windows were checked against the raw contact lines and matched.
    - **Re-summons and re-charms are not separate lives.** One row spans first to last with
      whatever gaps in between, because a row per instance splits a pet's fight into slivers too
      short for any of their rates to mean anything. `resetNpcTracking` is the other half of that:
      it prunes contact times the way it prunes damage — what *reached* the mob resets (a respawn
      wearing the name is a fresh instance), what it **dealt to another mob** survives, because
      that is pet damage banked in a still-running encounter. Without the second half, a pet
      re-charmed mid-fight restarted its window and read as seconds old.
  - `EncounterCard.startedSec` says where the window sits inside the encounter, so a row can name
    *which* end it is short at. A pet that died at the halfway mark and a player who arrived at
    the halfway mark are otherwise the same number, and the `time` tooltip called both "joined
    late".
  - The two kinds stay distinguishable, because they need different things said about them —
    `petKind: "summoned" | "charmed"`, drawn as **🐾** and **⛓** in the same slot at the same
    weight (they answer one question, "why is this on our side?", with different answers). Both
    carry the owner's name as a tag: whose pet it is stays readable without the damage moving.
  - `ownerName` on an encounter card is therefore the **summoner or the charmer**, no longer the
    charmer alone, and the row styling pets already had is reused for both.
  - **The glyph carries the identity, not the text.** A charmed mob keeps its own name, which reads
    exactly like the enemy it was a moment ago — and at 540px the name is the first thing the
    ellipsis eats. Giving charmed mobs a row at all surfaced **91,180 damage** across the real log
    that had been invisible.
  - An `ambiguous` row adds a **`~`** tag in the `--partial` amber: its figures are the whole
    exchange between two same-named mobs, so they bound the pet rather than measure it. The
    tag qualifies the numbers rather than naming anyone, which is the same job the `time`
    column's flag does in the same colour.
  - `.erow.pet`'s fill moved from a teal a step from `--player`'s green to a clearly cooler
    cyan. It had been unreachable while every pet folded into its owner; now a charmed pet
    and a groupmate share a table, so the two must not read alike. Colour is never the only
    signal — the row also carries the glyph and its charmer's name.
- **Every contributor ships; the table folds the tail.** `encounterView` used to send `self + top 5`
  and nothing else, so a truncation taken in the engine was one the UI could never undo — on the
  real log, encounters run to **10 contributors** and the four the cut discarded were **up to 15% of
  the mob's damage** (a 10-card fire giant fight hid 13.2%; a King Tranix pull hid 15.1%). `cards`
  is now the whole ranked list and the fold is the client's decision.
  - The table opens on **six rows**, which is exactly what the engine used to send, so nothing about
    an ordinary group fight changed. Below them a quiet control row — `▸ 4 more` with the tail's
    **share of the encounter's damage** at the right — expands to everyone and collapses back to
    `▾ top 6 only`.
  - The share is the point of the row: `+4 more` alone cannot distinguish four archers who each
    landed a shot from half a raid. It divides by the encounter total, not by the tail's own sum, so
    the figure is comparable between fights, and it is placed in the **bar column** so it lines up
    under the other percentages — flexed to the panel edge it landed under `time` and read as a
    duration.
  - **Your own row is held in the opening six however far down you rank** (`foldEncounterCards`,
    `web/src/stats.ts`), which is what the old engine-side splice did. On a night spent healing you
    are nowhere near the top, and a meter that cannot show you yourself without a click is worse
    than one that never had the rest. You displace the sixth row rather than adding a seventh, and
    sit in rank order among them.
  - **Expanding opens every row's drill-down with it**, so "who else was here" arrives together
    with "and what did they do" instead of ten more things to click. Collapsing closes them again,
    which is the only inverse that leaves the table as it was found.
  - That makes the control a **batch set, not a toggle** (`onSetOpen(keys, open)` in `App.tsx`,
    beside the single-key `toggle`). Toggling each key would *close* whichever rows you had
    already opened by hand, so the same button would do different things depending on what you
    had clicked before pressing it. The fold writes the keys; it never forces a row's `open` past
    them, so any row still closes on its own click while the table stays expanded.
  - Fold state lives in App-level `expanded` under a `${enc.id}:*all*` key, beside the per-row
    drills — not in the table's own state, where a snapshot push mid-fight would fold it back up
    under someone reading it. Both key shapes are built by `rowKey`/`allRowsKey`/`foldKeys` in
    `stats.ts` and pinned by tests, because a button writing keys no row reads fails **silently**:
    no error, just a control that does half its job.
  - Cost measured before shipping: a card is ~1KB and the median encounter has 5, so the full
    snapshot moved by a few KB. This is not a payload worth truncating for.
  - The newly visible tail exposes an existing (correct) rule: another player's **summoned** pet
    keeps its own row in `--player` green, because only *your* pet folds into you (`petOwners` is
    fed by `Master` lines, which only ever name your own) and `kind: "pet"` is reserved for charms.
- **Your own row is always expanded** in every encounter table, marked with a blue left rule;
  everyone else toggles on click.
- **The drill-down is two rows**, because they answer different questions and used to share one
  line. The top row is the **broad shape** — total damage, then the melee / spell / DoT split,
  with crits pinned right — and it is the part that stays comparable between rows and between
  fights, so an empty category dims rather than vanishing and the row keeps its shape. The
  second row is the per-ability detail (top 4). Since your own row is always open, this pair is
  what sits permanently on screen under your name.
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
  - Below the chart, a **progression strip** shows current level and unspent AA, then what the window bought: levels, AA, abilities, deaths (in the rail's own glyphs, so the strip doubles as its legend), and — deliberately glyph-less, since they are counted but never marked — skill-ups and summed xp percent.
- **One tabbed stats container sits between My DPS and the encounters** — Levels · AA · Stances ·
  Deaths. Four separate collapsible boxes came first and cost **four rows of a 540px panel to say
  nothing**; vertical space is the scarce resource here and these are all things you consult
  occasionally rather than watch. Closed, the strip is a **single row**. Only the selected panel
  is mounted at all, and clicking the open tab closes it, so "all closed" stays one click away.
  - **A tab carries a figure, not just a noun** (`Levels 1h 52m`, `Deaths 5`) — the strip is on
    screen permanently, so each label should be worth reading without opening anything.
  - Deaths only earns a tab once there are some, and tints the container red when open.
  - Completed rows carry the **clock time** and the **zone** the milestone landed in — without
    the time, four identical `+2 AA` labels stack up with nothing to tell them apart; the zone
    answers "which camp was that". Zone names run long, so the column ellipsises with the full
    name in the `title`. The open row has no milestone of its own, so it has neither.
- **The "what killed me" tab** renders only when there are deaths. Each
  one is three lines: the killer and the **last blow to land**, then the damage by ability, then
  by attacker with the stance I died in. The two breakdown lines are the point — dying to one
  thing and dying to six look nothing alike, and no single total says which happened (one real
  death read `a festering hag 749 · a skeletal monk 162 · a greater dark bone 150 · a barbed bone
  skeleton 106 · a dusty werebat 63`, which is an add problem, not a tanking one).
  - **"no heals" is printed, not omitted.** Whether anyone was healing is half of why a death
    happened, and on every death in the real log the answer was nobody — an absence worth
    stating in the `--partial` amber rather than leaving as blank space.
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

Only the **default log directory** is OS-specific, and even that is one layout with three roots:
the macOS Wine bottle mirrors Windows exactly (`drive_c/users/Public/…`), so the path below the
drive root is shared and lives in one constant. The logs sit under the **Public** user on
Windows, not the current one — an earlier guess used `homedir()` and would never have found them.
The tailer, parser, engine, server and UI are all OS-agnostic, so "runs on a PC too" is
essentially free.

**Launchers.** `start.command` (macOS/Linux) and `start.bat` (Windows) are twins: check for Node,
install on first run, build the UI, open the browser a moment later, then serve in the
foreground. Keep them in step. Two Windows-specific traps the batch file has to dodge, both of
which silently half-work otherwise:
- **every `npm` call needs `call`** — npm is itself a `.cmd`, so without it cmd.exe hands control
  over and the batch file simply stops after the first one;
- **`cmd /c "…"` mis-parses nested quotes**, so the delayed browser open leaves the URL unquoted
  (it has no spaces), and uses `ping` rather than `timeout`, which aborts when stdin is
  redirected — as it is inside a detached `cmd`.

`.gitattributes` pins `*.bat` to CRLF and the shell scripts to LF: a batch file is meant to be
double-clicked on a machine that may never see this repo again, and a `.command` with CRLF fails
on its shebang line.
