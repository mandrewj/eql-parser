import { useEffect, useMemo, useState } from "react";
import { time } from "./format";
import {
  buildIslands,
  completedQuestNames,
  progressOf,
  readyQuests,
  recentCompletions,
  RECENT_COMPLETIONS,
  RUNE_SOURCE,
  type CompletedSet,
  type NeedRow,
  type QuestState,
} from "./sky-model";
import type { SkyClass, SkyQuest, SkyStats } from "./types";

/** The Plane of Sky class-quest tracker.
 *
 *  Two sources meet here and neither is sufficient alone: the catalogue (immutable, fetched once
 *  from `/api/sky-quests`) says what each of the 16 classes needs, and the snapshot says what is
 *  held — the inventory export as a baseline, plus anything looted since it was written.
 *
 *  A class at a time, because 95 quests over 16 classes is not a table anyone reads at 540px, and
 *  the question is always asked one class at a time anyway.
 *
 *  The arithmetic — what counts as finished, what is still worth farming — lives in
 *  [`sky-model.ts`](./sky-model.ts); this file is what draws it.
 */

const STATE_GLYPH: Record<QuestState, string> = {
  done: "✓",
  ready: "◆",
  partial: "◐",
  open: "○",
};

const STATE_TITLE: Record<QuestState, string> = {
  done: "reward held — quest complete",
  ready: "every component held — ready to turn in",
  partial: "some components held",
  open: "nothing held yet",
};

/** The last class and view, so the tab opens where it was left. Same courtesy the log picker
 *  extends; a 16-way selector that resets to Bard on every reload is a small daily annoyance. */
const STORE_KEY = "eql.sky.class";
const VIEW_KEY = "eql.sky.view";

/** The two questions this data answers, which want opposite arrangements. **By class** is
 *  "how far along is my Bard" — the catalogue's own shape. **By island** is "I am standing on
 *  Island 5, what do I look for" — which cuts across all 16 classes at once and is the view you
 *  actually keep open while playing. Neither is a filter of the other. */
type View = "class" | "island";

/** One component of an island. The right-hand columns say who wants it and how far off it is;
 *  a settled row keeps both, because "BST SHM · 2/2" is the answer, not clutter. */
function NeedRowLine({ r, where }: { r: NeedRow; where?: string | null }) {
  const codes = [...new Set(r.wants.map((w) => w.code))].join(" ");
  const mark = r.state === "done" ? "✓" : r.state === "held" ? "✓" : r.held > 0 ? "◐" : "·";
  return (
    <div
      className={`skyrow need-${r.state}`}
      title={
        (r.dropsFrom ? `Drops from ${r.dropsFrom}\n` : "") +
        r.wants.map((w) => `${w.done ? "✓ " : ""}${w.quest}`).join("\n")
      }
    >
      <span className="skymark">{mark}</span>
      <span className="skyname">{r.name}</span>
      {r.held > 0 && where && <span className="skywhere">{where}</span>}
      <span className="skywants">{codes}</span>
      <span className="skycount">
        {r.state === "done"
          ? "turned in"
          : r.state === "held"
            ? `×${r.held}`
            : r.held > 0
              ? `${r.held}/${r.need}`
              : r.need > 1
                ? `×${r.need}`
                : ""}
      </span>
    </div>
  );
}

function IslandView({
  catalogue,
  held,
  completed,
  where,
}: {
  catalogue: SkyClass[];
  held: Map<string, number>;
  completed: CompletedSet;
  where: Map<string, string | null>;
}) {
  const islands = useMemo(() => buildIslands(catalogue, held, completed), [catalogue, held, completed]);
  const total = islands.reduce((n, i) => n + i.needCount, 0);
  const places = islands.filter((i) => i.needCount > 0).length;

  return (
    <>
      <div className="skyneedtotal">
        {total > 0
          ? `${total} components still needed, across ${places} locations`
          : "Nothing outstanding — every component is either held or already turned in."}
      </div>
      <div className="skyislands">
        {islands.map((isl) => (
          <div className="skyisland" key={isl.island}>
            <div className="section-title">
              {isl.island}
              <span className="skyclsdone">
                {isl.needCount}
                {isl.settledCount > 0 && <span className="skyisldone"> +{isl.settledCount}</span>}
              </span>
            </div>
            {/* Under the mob that drops it, not a flat list: you kill mobs, not islands, and on a
                real island one boss owes you almost everything — Island 5's Spiroc Lord holds 15
                of its 16. The heading is what turns the list into a plan. */}
            {isl.outstanding.map((g) => (
              <div className="skymob" key={g.mob ?? "(unsourced)"}>
                <div className="skymobname">{g.mob ?? "no mob listed"}</div>
                {g.rows.map((r) => (
                  <NeedRowLine key={r.name} r={r} where={where.get(r.name) ?? null} />
                ))}
              </div>
            ))}
            {/* Settled rows, flat and dimmed, at the foot of their island. Not grouped by mob:
                that heading answers "where would I farm this", which is the one question these
                rows do not raise. */}
            {isl.settled.length > 0 && (
              <div className="skysettled">
                <div className="skymobname">have / turned in</div>
                {isl.settled.map((r) => (
                  <NeedRowLine key={r.name} r={r} where={where.get(r.name) ?? null} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ItemRow({
  name,
  note,
  count,
  kind,
  title,
  where,
}: {
  name: string;
  note: string | null;
  count: number | undefined;
  kind: "component" | "rune" | "reward";
  title?: string;
  /** Where it is, when it is held — the bank and the currency tab are both "have it", but only
   *  one of them is on you when you reach the quest giver. */
  where?: string | null;
}) {
  const held = count !== undefined;
  return (
    <div className={held ? `skyrow ${kind} held` : `skyrow ${kind}`} title={title}>
      <span className="skymark">{held ? "✓" : "·"}</span>
      <span className="skyname">{name}</span>
      {held && where && <span className="skywhere">{where}</span>}
      {note && <span className="skynote">{note}</span>}
      {/* Always the number, never the word. Runes stack into one slot with a quantity beside
          them, and several quests want the same one — so "have" hid the only figure that says
          whether one rune covers one quest or three. */}
      <span className="skycount">{held ? `×${count}` : "—"}</span>
    </div>
  );
}

function QuestBlock({
  quest,
  held,
  completed,
  where,
}: {
  quest: SkyQuest;
  held: Map<string, number>;
  completed: CompletedSet;
  where: Map<string, string | null>;
}) {
  const p = progressOf(quest, held, completed);
  return (
    <div className={`skyquest ${p.state}`}>
      <div className="skyqhead" title={STATE_TITLE[p.state]}>
        <span className="skyqmark">{STATE_GLYPH[p.state]}</span>
        <span className="skyqname">{quest.quest}</span>
        {/* Not on a finished quest: the turn-in consumed the components, so "0/1" there reads as
            progress lost rather than as a quest already done. The glyph and colour say done. */}
        {p.state !== "done" && (
          <span className="skyqcount">
            {p.have}/{p.need}
          </span>
        )}
        <span className="skytrigger" title="what you say to the quest giver">
          “{quest.trigger}”
        </span>
      </div>
      {/* A component like any other. It is not labelled "started" either: the 15 runes are shared
          across the 16 classes, so holding Wind Rune Neza could be for this quest or for one of
          the five others that also want it. Held is all that can honestly be claimed. */}
      <ItemRow
        name={quest.rune}
        note={p.runeHeld ? "rune" : RUNE_SOURCE}
        count={held.get(quest.rune)}
        where={where.get(quest.rune)}
        kind="rune"
        title={`Wind runes drop from ${RUNE_SOURCE}. The same rune is wanted by quests in several classes, and a turn-in consumes one.`}
      />
      {quest.items.map((it) => (
        <ItemRow
          key={it.name}
          name={it.name}
          note={it.island}
          count={held.get(it.name)}
          where={where.get(it.name)}
          kind="component"
          title={it.dropsFrom ? `Drops from ${it.dropsFrom}` : "No drop source listed on the wiki"}
        />
      ))}
      {quest.rewards.map((r) => (
        <ItemRow key={r} name={r} note="reward" count={held.get(r)} where={where.get(r)} kind="reward" />
      ))}
    </div>
  );
}

/** The strip that says how current the answer is. Without it a row of dashes is ambiguous —
 *  "I don't have it" and "nobody has told me what you have" look identical, and only one of
 *  those is fixed by playing. */
function Baseline({ sky }: { sky: SkyStats }) {
  const file = sky.inventoryPath?.split(/[\\/]/).pop() ?? null;

  // No log selected at all — there is no character to name a file after yet.
  if (!file) {
    return <div className="skybase warn">Select a log to track a character&apos;s Plane of Sky progress.</div>;
  }

  // `inventoryMs` rather than the path is the test for "was it read": the path is derived from
  // the selected log and exists whether or not the file does, which is exactly what lets this
  // name the file it is waiting for instead of shrugging.
  if (sky.inventoryMs === null) {
    return (
      <div className="skybase warn" title={sky.inventoryPath ?? undefined}>
        Waiting for <code>{file}</code>. In game, run <code>/outputfile inventory</code> — this tab
        picks it up within a few seconds of the game confirming it. Until then only items looted
        while the parser is running can be counted.
      </div>
    );
  }

  return (
    <div className="skybase" title={sky.inventoryPath ?? undefined}>
      <span className="skybasefile">{file}</span>
      <span className="muted">
        {sky.inventoryItems} items · read {time(sky.inventoryMs)}
      </span>
      {sky.recentLoot.length > 0 && <span className="skybasenew">+{sky.recentLoot.length} from the log</span>}
    </div>
  );
}

/** What is actionable now, and what has recently been finished.
 *
 *  The two belong in one box because they are the same story a step apart: a quest goes ready,
 *  you walk to the NPC, and it becomes complete. Ready is derived from what is held; complete is
 *  an *event* the log witnessed (`You have been given: <reward>`), which is the only thing that
 *  puts a date on a turn-in — holding the reward says a quest is done, never when. A quest
 *  finished before this log begins is therefore still ✓ in the class view but is not listed here,
 *  which is what "recently" means.
 *
 *  It sits above the view switch because it is true of both views and is the first thing worth
 *  reading; it renders nothing at all when there is neither. */
function ProgressBox({
  catalogue,
  held,
  doneNames,
  completed,
}: {
  catalogue: SkyClass[];
  held: Map<string, number>;
  doneNames: CompletedSet;
  completed: SkyStats["completed"];
}) {
  const ready = useMemo(() => readyQuests(catalogue, held, doneNames), [catalogue, held, doneNames]);
  const { shown: done, more } = useMemo(() => recentCompletions(catalogue, completed), [catalogue, completed]);
  if (!ready.length && !done.length) return null;

  return (
    <div className="skyprogress">
      {ready.length > 0 && (
        <>
          <div className="skypghead ready">
            Ready to turn in<span className="skypgn">{ready.length}</span>
          </div>
          {ready.map((r) => (
            <div className="skypgrow" key={`${r.code}-${r.quest.quest}`}>
              <span className="skymark ready">◆</span>
              <span className="skyname">{r.quest.quest}</span>
              <span className="skynote">
                {r.giver} · say “{r.quest.trigger}”
              </span>
              <span className="skypgreward">{r.quest.rewards.join(", ")}</span>
            </div>
          ))}
        </>
      )}
      {done.length > 0 && (
        <>
          {/* The badge counts the rows beneath it, not every turn-in ever — the same rule the
              mote list follows, and for the same reason: a number above a shorter list reads as
              a bug. What the cap is hiding gets said outright instead. */}
          <div className="skypghead done">
            Recently complete<span className="skypgn">{done.length}</span>
            {more > 0 && (
              <span
                className="skypgmore"
                title={`${more} finished earlier. They are still ✓ in the class and island views — only this list is capped, at ${RECENT_COMPLETIONS}.`}
              >
                +{more} earlier
              </span>
            )}
          </div>
          {done.map((d) => (
            <div className="skypgrow" key={`${d.reward}-${d.tsMs}`}>
              <span className="skymark done">✓</span>
              <span className="skyname">{d.quest}</span>
              <span className="skynote">{d.code}</span>
              <span className="skypgreward">{d.reward}</span>
              <span className="skycount">{time(d.tsMs)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function SkyPanel({ catalogue, sky }: { catalogue: SkyClass[] | null; sky: SkyStats }) {
  const [code, setCode] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null; // private mode, or storage disabled
    }
  });
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "island" ? "island" : "class";
    } catch {
      return "class";
    }
  });

  useEffect(() => {
    try {
      if (code) localStorage.setItem(STORE_KEY, code);
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* not worth failing a render over */
    }
  }, [code, view]);

  // name → count. The catalogue's spelling is the key on both sides, which is what the
  // server's normalisation exists to guarantee.
  const held = useMemo(() => new Map(sky.held.map((h) => [h.name, h.count])), [sky.held]);
  const where = useMemo(() => new Map(sky.held.map((h) => [h.name, h.where])), [sky.held]);
  // Quests the log saw handed in. Permanent, and what `progressOf` trusts over holding the
  // reward — a reward can be banked or sold without un-finishing the quest.
  const done = useMemo(
    () => (catalogue ? completedQuestNames(catalogue, sky.completed) : new Set<string>()),
    [catalogue, sky.completed],
  );

  // Completed quests per class, for the badge on each chip: the one number that says where
  // the effort has gone without opening all 16.
  const doneByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalogue ?? []) {
      m.set(c.code, c.quests.filter((q) => progressOf(q, held, done).state === "done").length);
    }
    return m;
  }, [catalogue, held, done]);

  if (!catalogue) {
    return <div className="idle">Loading the Plane of Sky catalogue…</div>;
  }

  const cls = catalogue.find((c) => c.code === code) ?? catalogue[0]!;

  return (
    <div className="skypanel">
      <Baseline sky={sky} />

      <ProgressBox catalogue={catalogue} held={held} doneNames={done} completed={sky.completed} />

      <nav className="skyviews">
        <button className={view === "class" ? "tab on" : "tab"} onClick={() => setView("class")}>
          By class
        </button>
        <button className={view === "island" ? "tab on" : "tab"} onClick={() => setView("island")}>
          By island
        </button>
      </nav>

      {view === "island" ? (
        <IslandView catalogue={catalogue} held={held} completed={done} where={where} />
      ) : (
        <ClassView catalogue={catalogue} cls={cls} held={held} completed={done} where={where} doneByClass={doneByClass} onPick={setCode} />
      )}

      {/* Shared by both views: what the log has added since the export is the one part of this
          panel that is live, and it answers the same question whichever way the table is cut. */}
      {sky.recentLoot.length > 0 && (
        <>
          {/* Not "looted since the export": an item routed to the currency tab is counted
              whenever it was looted, because no export ever lists it. The storage is shown on
              the row, which is what explains an entry older than the baseline. */}
          <div className="section-title">Sky pickups from the log</div>
          <div className="skypickups">
          {sky.recentLoot.map((l, i) => (
            <div className="skyrow held" key={`${l.tsMs}-${l.name}-${i}`}>
              <span className="skymark">✓</span>
              <span className="skyname">{l.name}</span>
              <span className="skynote">{l.storedIn ? `${l.from} → ${l.storedIn}` : l.from}</span>
              <span className="skycount">{time(l.tsMs)}</span>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClassView({
  catalogue,
  cls,
  held,
  completed,
  where,
  doneByClass,
  onPick,
}: {
  catalogue: SkyClass[];
  cls: SkyClass;
  held: Map<string, number>;
  completed: CompletedSet;
  where: Map<string, string | null>;
  doneByClass: Map<string, number>;
  onPick: (code: string) => void;
}) {
  // From the same map the chips read, rather than a second pass over the class's quests.
  const done = doneByClass.get(cls.code) ?? 0;
  return (
    <>
      <nav className="skychips">
        {catalogue.map((c) => {
          const n = doneByClass.get(c.code) ?? 0;
          return (
            <button
              key={c.code}
              className={c.code === cls.code ? "chip on" : "chip"}
              onClick={() => onPick(c.code)}
              title={`${c.className} — ${c.giver}`}
            >
              {c.code}
              {n > 0 && <span className="skychipn">{n}</span>}
            </button>
          );
        })}
      </nav>

      <div className="section-title">
        {cls.className} · <span className="muted">{cls.giver}</span>
        <span className="skyclsdone">
          {done}/{cls.quests.length} complete
        </span>
      </div>

      <div className="skyquests">
        {cls.quests.map((q) => (
          <QuestBlock key={q.quest} quest={q} held={held} completed={completed} where={where} />
        ))}
      </div>
    </>
  );
}
