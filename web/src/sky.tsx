import { useEffect, useMemo, useState } from "react";
import { time } from "./format";
import { buildNeeds, progressOf, type QuestState } from "./sky-model";
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

function IslandView({ catalogue, held }: { catalogue: SkyClass[]; held: Map<string, number> }) {
  const groups = useMemo(() => buildNeeds(catalogue, held), [catalogue, held]);
  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  if (!total) {
    return <div className="idle">Nothing outstanding — every quest component is either held or already turned in.</div>;
  }

  return (
    <>
      <div className="skyneedtotal">
        {total} components still needed, across {groups.length} locations
      </div>
      {groups.map(([island, list]) => (
        <div key={island ?? "none"}>
          <div className="section-title">
            {island ?? "No island listed"}
            <span className="skyclsdone">{list.length}</span>
          </div>
          {list.map((r) => (
            <div
              className={r.held > 0 ? "skyrow held" : "skyrow"}
              key={r.name}
              title={
                (r.dropsFrom ? `Drops from ${r.dropsFrom}\n` : "") +
                r.wants.map((w) => w.quest).join("\n")
              }
            >
              <span className="skymark">{r.held > 0 ? "◐" : "·"}</span>
              <span className="skyname">{r.name}</span>
              {/* With no island to locate it by, the mob is the only pointer the row can give —
                  and the wiki does name one for all but a couple of these. The first source
                  only: the full list is in the tooltip and is far too long for the row. */}
              {r.island === null && r.dropsFrom && (
                <span className="skynote">{r.dropsFrom.split(",")[0]!.trim()}</span>
              )}
              <span className="skywants">{[...new Set(r.wants.map((w) => w.code))].join(" ")}</span>
              <span className="skycount">
                {r.held > 0 ? `${r.held}/${r.wants.length}` : r.wants.length > 1 ? `×${r.wants.length}` : ""}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function ItemRow({
  name,
  note,
  count,
  kind,
  title,
}: {
  name: string;
  note: string | null;
  count: number | undefined;
  kind: "component" | "rune" | "reward";
  title?: string;
}) {
  const held = count !== undefined;
  return (
    <div className={held ? `skyrow ${kind} held` : `skyrow ${kind}`} title={title}>
      <span className="skymark">{held ? "✓" : "·"}</span>
      <span className="skyname">{name}</span>
      {note && <span className="skynote">{note}</span>}
      <span className="skycount">{count !== undefined && count > 1 ? `×${count}` : held ? "have" : "—"}</span>
    </div>
  );
}

function QuestBlock({ quest, held }: { quest: SkyQuest; held: Map<string, number> }) {
  const p = progressOf(quest, held);
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
        <span className="skytrigger" title="say this to the quest giver to be handed the rune">
          “{quest.trigger}”
        </span>
      </div>
      {/* Deliberately not labelled "started": the 15 runes are shared across the 16 classes, so
          holding Wind Rune Neza could be for this quest or for the Warrior one that also wants
          it. Held is all that can honestly be claimed. */}
      <ItemRow
        name={quest.rune}
        note={p.runeHeld ? "rune" : "ask the giver"}
        count={held.get(quest.rune)}
        kind="rune"
        title="Handed over by the quest giver when you say the trigger phrase, rather than looted. The same rune serves quests in several classes."
      />
      {quest.items.map((it) => (
        <ItemRow
          key={it.name}
          name={it.name}
          note={it.island}
          count={held.get(it.name)}
          kind="component"
          title={it.dropsFrom ? `Drops from ${it.dropsFrom}` : "No drop source listed on the wiki"}
        />
      ))}
      {quest.rewards.map((r) => (
        <ItemRow key={r} name={r} note="reward" count={held.get(r)} kind="reward" />
      ))}
    </div>
  );
}

/** The strip that says how current the answer is. Without it a row of dashes is ambiguous —
 *  "I don't have it" and "nobody has told me what you have" look identical, and only one of
 *  those is fixed by playing. */
function Baseline({ sky }: { sky: SkyStats }) {
  if (!sky.inventoryPath) {
    return (
      <div className="skybase warn">
        No inventory export found. In game, run <code>/outputfile inventory</code> — it writes
        <code> &lt;Character&gt;_&lt;server&gt;-Inventory.txt</code> next to the game folder, and this tab picks it
        up within a few seconds. Until then only items looted while the parser is running can be counted.
      </div>
    );
  }
  const file = sky.inventoryPath.split(/[\\/]/).pop();
  return (
    <div className="skybase" title={sky.inventoryPath}>
      <span className="skybasefile">{file}</span>
      <span className="muted">
        {sky.inventoryItems} items · read {sky.inventoryMs ? time(sky.inventoryMs) : "—"}
      </span>
      {sky.recentLoot.length > 0 && <span className="skybasenew">+{sky.recentLoot.length} looted since</span>}
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

  // Completed quests per class, for the badge on each chip: the one number that says where
  // the effort has gone without opening all 16.
  const doneByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalogue ?? []) {
      m.set(
        c.code,
        c.quests.filter((q) => progressOf(q, held).state === "done").length,
      );
    }
    return m;
  }, [catalogue, held]);

  if (!catalogue) {
    return <div className="idle">Loading the Plane of Sky catalogue…</div>;
  }

  const cls = catalogue.find((c) => c.code === code) ?? catalogue[0]!;

  return (
    <div className="skypanel">
      <Baseline sky={sky} />

      <nav className="skyviews">
        <button className={view === "class" ? "tab on" : "tab"} onClick={() => setView("class")}>
          By class
        </button>
        <button className={view === "island" ? "tab on" : "tab"} onClick={() => setView("island")}>
          By island
        </button>
      </nav>

      {view === "island" ? (
        <IslandView catalogue={catalogue} held={held} />
      ) : (
        <ClassView catalogue={catalogue} cls={cls} held={held} doneByClass={doneByClass} onPick={setCode} />
      )}

      {/* Shared by both views: what the log has added since the export is the one part of this
          panel that is live, and it answers the same question whichever way the table is cut. */}
      {sky.recentLoot.length > 0 && (
        <>
          <div className="section-title">Looted since the export</div>
          {sky.recentLoot.map((l, i) => (
            <div className="skyrow held" key={`${l.tsMs}-${l.name}-${i}`}>
              <span className="skymark">✓</span>
              <span className="skyname">{l.name}</span>
              <span className="skynote">{l.from}</span>
              <span className="skycount">{time(l.tsMs)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ClassView({
  catalogue,
  cls,
  held,
  doneByClass,
  onPick,
}: {
  catalogue: SkyClass[];
  cls: SkyClass;
  held: Map<string, number>;
  doneByClass: Map<string, number>;
  onPick: (code: string) => void;
}) {
  const done = cls.quests.filter((q) => progressOf(q, held).state === "done").length;
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

      {cls.quests.map((q) => (
        <QuestBlock key={q.quest} quest={q} held={held} />
      ))}
    </>
  );
}
