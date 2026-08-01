import { useEffect, useMemo, useState } from "react";
import { time } from "./format";
import type { SkyClass, SkyQuest, SkyStats } from "./types";

/** The Plane of Sky class-quest tracker.
 *
 *  Two sources meet here and neither is sufficient alone: the catalogue (immutable, fetched once
 *  from `/api/sky-quests`) says what each of the 16 classes needs, and the snapshot says what is
 *  held — the inventory export as a baseline, plus anything looted since it was written.
 *
 *  A class at a time, because 95 quests over 16 classes is not a table anyone reads at 540px, and
 *  the question is always asked one class at a time anyway.
 */

/** Where a quest stands. Derived rather than stored — there is no persistence in this app, and
 *  the whole state is a function of the export and the log. */
type QuestState = "done" | "ready" | "partial" | "open";

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

/** The last class looked at, so the tab opens where it was left. Same courtesy the log picker
 *  extends; a 16-way selector that resets to Bard on every reload is a small daily annoyance. */
const STORE_KEY = "eql.sky.class";

interface QuestProgress {
  state: QuestState;
  /** Components held / needed. Excludes the rune, which is asked for rather than found. */
  have: number;
  need: number;
  runeHeld: boolean;
}

function progressOf(quest: SkyQuest, held: Map<string, number>): QuestProgress {
  const have = quest.items.filter((i) => held.has(i.name)).length;
  const need = quest.items.length;
  // Every reward, not any: Beastlord's Test of Claw hands over a weapon for each hand, and
  // holding one of the two is not a finished quest.
  const done = quest.rewards.length > 0 && quest.rewards.every((r) => held.has(r));
  const state: QuestState = done ? "done" : have === need && need > 0 ? "ready" : have > 0 ? "partial" : "open";
  return { state, have, need, runeHeld: held.has(quest.rune) };
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
        <span className="skyqcount">
          {p.have}/{p.need}
        </span>
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

  useEffect(() => {
    try {
      if (code) localStorage.setItem(STORE_KEY, code);
    } catch {
      /* not worth failing a render over */
    }
  }, [code]);

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
  const done = cls.quests.filter((q) => progressOf(q, held).state === "done").length;

  return (
    <div className="skypanel">
      <Baseline sky={sky} />

      <nav className="skychips">
        {catalogue.map((c) => {
          const n = doneByClass.get(c.code) ?? 0;
          return (
            <button
              key={c.code}
              className={c.code === cls.code ? "chip on" : "chip"}
              onClick={() => setCode(c.code)}
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
