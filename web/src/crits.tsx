import { useEffect, useState } from "react";
import { fmt, fmtDrill, time } from "./format";
import {
  critAverages,
  critRate,
  critShare,
  isThinCrits,
  isThinSample,
  shownAbilities,
  THIN_CRITS,
  THIN_SAMPLE,
} from "./stats";
import type {
  CritAbility,
  CritCategory,
  CritCategoryStat,
  CritKind,
  CritRecord,
  CritRecords,
  CritStats,
  CritWindow,
  CritWindowKey,
} from "./types";

/** The critical-hit tracker.
 *
 *  One question, asked five ways: **of the times I dealt damage, how often did it crit** — and
 *  when it did, how hard. Everything here is the logging character's own output over the whole
 *  session; a pet's swings and a groupmate's nuke are theirs, and folding them in would move a
 *  number the panel presents as a fact about this character.
 *
 *  The five rows are not the meters' damage types. They are a split by *what can crit*, which is
 *  a different question and has a surprising answer: the `non-melee` line form — every proc and
 *  damage shield in the game — has never once carried a crit flag in a 2M-line log. Folded in
 *  with named abilities it would divide 5 crits by 55,000 hits and call that a spell crit rate.
 *  It gets its own row, marked, and the spell rate divides by named abilities alone.
 *
 *  The arithmetic lives in [`stats.ts`](./stats.ts); this file is what draws it.
 */

const CATEGORY_LABEL: Record<CritCategory, string> = {
  melee: "Melee",
  spell: "Spells",
  dot: "Damage over time",
  heal: "Heals",
  proc: "Procs & shields",
};

const CATEGORY_NOTE: Record<CritCategory, string> = {
  melee: "Plain weapon swings — every hit that reads “for N points of damage”.",
  spell: "Named abilities — the form that states its own spell (“…of fire damage by Ignite”).",
  dot: "Damage-over-time ticks. Each tick is its own roll, so a long DoT is many chances.",
  heal: "Healing you cast, in combat and out. Effective healing, as the meters count it.",
  proc: "Procs and damage shields — the “non-melee” line form. The game has never flagged one of these as a critical, so there is no rate to report.",
};

/** How each flag reads in prose. All four are critical hits; three of them just don't say so. */
const KIND_LABEL: Record<CritKind, string> = {
  critical: "critical",
  crippling: "crippling blow",
  slay: "slay undead",
  finishing: "finishing blow",
};

const pct = (v: number | null, digits = 1) => (v === null ? "—" : `${v.toFixed(digits)}%`);

/** The three the records board leads with. Melee, spells and damage over time are the three ways
 *  this character deals damage; heals and procs have records too and keep them on their own row,
 *  where a healing number cannot be mistaken for a damage one. */
const RECORD_CATEGORIES: CritCategory[] = ["melee", "spell", "dot"];

const RECORD_LABEL: Record<string, string> = {
  melee: "Biggest melee crit",
  spell: "Biggest spell crit",
  dot: "Biggest DoT crit",
};

/** One record tile. The headline is the biggest **crit**, which is what the board is for — but
 *  the hardest thing you land is not always a crit, so the outright record is printed underneath
 *  whenever it is a different hit. That is not a hypothetical: this character's biggest spell hit
 *  is a 647 Denon's Desperate Dirge that never critted, against a biggest spell crit of 220.
 *  Leading with 220 alone would read as broken to anyone who watched the 647 land. */
function RecordTile({ c }: { c: CritRecords }) {
  const { best, bestHit } = c;
  const outright = bestHit && (!best || bestHit.amount > best.amount) ? bestHit : null;

  return (
    <div className={`crit-record ${best ? "" : "nil"}`}>
      <div className="crit-record-cap">
        <span className={`crit-dot ${c.category}`} />
        {RECORD_LABEL[c.category]}
      </div>
      {best ? (
        <>
          <div className="crit-record-amt" title={`${KIND_LABEL[best.kind ?? "critical"]} · ${time(best.tsMs)}`}>
            {fmt(best.amount)}
          </div>
          <div className="crit-record-by" title={`${best.ability} on ${best.target}`}>
            {best.ability} <span className="muted">→ {best.target}</span>
          </div>
          <div className="crit-record-when muted">{when(best.tsMs)}</div>
        </>
      ) : (
        <>
          <div className="crit-record-amt none">—</div>
          <div className="crit-record-by muted">
            {bestHit ? "no crits yet" : "nothing recorded yet"}
          </div>
          <div className="crit-record-when" />
        </>
      )}
      {outright && (
        <div className="crit-record-alt" title={`${outright.ability} on ${outright.target} · ${when(outright.tsMs)}`}>
          hardest hit <b>{fmt(outright.amount)}</b> — {outright.ability}
          <span className="crit-record-nocrit">, not a crit</span>
        </div>
      )}
    </div>
  );
}

/** Date + clock, because a record is usually days old — "11:15 PM" alone would invite reading it
 *  as today's. */
const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + time(ms);

/** A record, as one line: how big, what did it, and to whom. */
function RecordLine({ r, showCategory = false }: { r: CritRecord; showCategory?: boolean }) {
  return (
    // The ability and target both ellipsise on a narrow panel, so the full text has to survive
    // somewhere — long spell names ("Tuyen's Chant of Flame VI") are exactly the ones that trim.
    <span className="crit-rec" title={`${fmt(r.amount)} — ${r.ability} on ${r.target} · ${r.kind ? KIND_LABEL[r.kind] : "not a crit"} · ${time(r.tsMs)}`}>
      <span className="crit-rec-amt">{fmt(r.amount)}</span>
      <span className="crit-rec-by">
        {showCategory && <span className={`crit-dot ${r.category}`} />}
        {r.ability}
      </span>
      <span className="crit-rec-at">→ {r.target}</span>
    </span>
  );
}

/** One ability's row inside an opened category. */
function AbilityRow({ a, best }: { a: CritAbility; best: number }) {
  const rate = critRate(a);
  const thin = isThinSample(a);
  return (
    <div className="crit-arow">
      <span className="crit-aname" title={a.name}>
        {a.name}
      </span>
      <span className="crit-anum">{fmt(a.hits)}</span>
      <span className="crit-anum">{a.crits ? fmt(a.crits) : "·"}</span>
      <span className={`crit-anum crit-rate ${thin ? "thin" : ""}`} title={thin ? THIN_TITLE(a.hits) : undefined}>
        {pct(rate)}
        {thin && <span className="crit-thin-mark">?</span>}
      </span>
      {/* A bar against the *category's* best, so the abilities are comparable to each other
          rather than each being scaled to itself. */}
      <span className="crit-abar">
        {a.best && <span className="crit-abar-fill" style={{ width: `${Math.max(2, (a.best.amount / best) * 100)}%` }} />}
        <span className="crit-abar-num">{a.best ? fmt(a.best.amount) : "—"}</span>
      </span>
    </div>
  );
}

const THIN_TITLE = (hits: number) =>
  `Only ${hits} hits — under ${THIN_SAMPLE} a percentage swings on a handful of rolls, so this is ` +
  `marked rather than presented as a settled rate.`;

const THIN_CRITS_TITLE = (crits: number) =>
  `Averaged over ${crits} crits — under ${THIN_CRITS} this says more about which ones happened ` +
  `to land than about what a crit is worth. The rate beside it is on firmer ground.`;

function CategoryBlock({ c, open, onToggle }: { c: CritCategoryStat; open: boolean; onToggle: () => void }) {
  const rate = critRate(c);
  const share = critShare(c);
  const { crit, normal, multiple } = critAverages(c);
  const thin = isThinSample(c);
  const thinCrits = isThinCrits(c);
  const abilities = open ? shownAbilities(c) : [];
  const bestAmount = c.best?.amount ?? 1;
  const empty = c.hits === 0;

  return (
    <div className={`crit-cat ${open ? "open" : ""} ${empty ? "nil" : ""}`}>
      <button className="crit-head" onClick={onToggle} disabled={empty} aria-expanded={open}>
        <span className="crit-caret">{empty ? "" : open ? "▾" : "▸"}</span>
        <span className={`crit-dot ${c.category}`} />
        <span className="crit-label" title={CATEGORY_NOTE[c.category]}>
          {CATEGORY_LABEL[c.category]}
        </span>

        <span className="crit-figs">
          <span className="crit-fig">
            <span className={`crit-big ${thin ? "thin" : ""}`} title={thin ? THIN_TITLE(c.hits) : undefined}>
              {pct(rate, 2)}
              {thin && <span className="crit-thin-mark">?</span>}
            </span>
            <span className="crit-unit">crit rate</span>
          </span>
          <span className="crit-fig">
            <span className="crit-mid">
              {c.crits ? fmt(c.crits) : "·"}
              <span className="crit-of">/{fmt(c.hits)}</span>
            </span>
            <span className="crit-unit">crits / hits</span>
          </span>
          {/* Both of these divide by the *crits*, not the hits, so they go thin far sooner than
              the rate beside them: this character has a solid 0.03% spell crit rate off 15,581
              casts and an average crit worth five rolls. Marking them is the difference between
              "my spell crits land soft" and "I have seen five of them". */}
          <span className="crit-fig">
            <span className={`crit-mid ${thinCrits ? "thin" : ""}`} title={thinCrits ? THIN_CRITS_TITLE(c.crits) : undefined}>
              {c.crits ? pct(share) : "—"}
              {thinCrits && <span className="crit-thin-mark">?</span>}
            </span>
            <span className="crit-unit">of {c.category === "heal" ? "healing" : "damage"}</span>
          </span>
          <span className="crit-fig">
            <span className={`crit-mid ${thinCrits ? "thin" : ""}`} title={thinCrits ? THIN_CRITS_TITLE(c.crits) : undefined}>
              {multiple === null ? "—" : `${multiple.toFixed(2)}×`}
              {thinCrits && <span className="crit-thin-mark">?</span>}
            </span>
            <span className="crit-unit">vs a normal hit</span>
          </span>
        </span>

        <span className="crit-best">{c.best ? <RecordLine r={c.best} /> : <span className="muted">—</span>}</span>
      </button>

      {open && (
        <div className="crit-body">
          <div className="crit-meta">
            <span className="muted small">{CATEGORY_NOTE[c.category]}</span>
            {crit !== null && normal !== null && (
              <span className="crit-avg small">
                mean crit <b>{fmtDrill(Math.round(crit))}</b> · mean ordinary hit{" "}
                <b>{fmtDrill(Math.round(normal))}</b>
              </span>
            )}
            {/* Only worth printing when more than one kind occurred — otherwise it restates
                the rate in words. The point of the line is that these three are crits that
                never say "Critical", so a Crippling Blow count is a finding. */}
            {c.byKind.length > 1 && (
              <span className="crit-kinds small">
                {c.byKind.map((k) => (
                  <span key={k.kind} className="crit-kind">
                    {KIND_LABEL[k.kind]} <b>{fmt(k.count)}</b>
                  </span>
                ))}
              </span>
            )}
          </div>

          {abilities.length > 0 ? (
            <div className="crit-atable">
              <div className="crit-arow head">
                <span className="crit-aname">{c.category === "melee" ? "attack" : "ability"}</span>
                <span className="crit-anum">hits</span>
                <span className="crit-anum">crits</span>
                <span className="crit-anum">rate</span>
                <span className="crit-abar">biggest crit</span>
              </div>
              {abilities.map((a) => (
                <AbilityRow key={a.name} a={a} best={bestAmount} />
              ))}
            </div>
          ) : (
            <div className="muted small crit-none">
              Nothing here has critted yet, and nothing has been used {THIN_SAMPLE} times — too
              early to say anything either way.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The windows, in the order they are offered — narrowest first, so moving right is reaching
 *  further back. */
const WINDOWS: Array<{ key: CritWindowKey; label: string; note: string }> = [
  {
    key: "session",
    label: "Session",
    note: "Since you last logged in — or the last 12 hours, whichever is shorter, so a client left running overnight can't fold yesterday into tonight.",
  },
  { key: "enc25", label: "25 fights", note: "The last 25 mobs you fought — about a camp." },
  { key: "enc100", label: "100 fights", note: "The last 100 mobs you fought — enough for the percentages to settle." },
  { key: "d14", label: "2 weeks", note: "The last 14 days, which is as far back as the tracker keeps hit-by-hit detail." },
];

/** The window last chosen, so the tab opens where it was left — the same courtesy the Sky tab
 *  and the log picker extend. */
const WINDOW_KEY = "eql.crits.window";

const isWindowKey = (v: string | null): v is CritWindowKey =>
  v !== null && WINDOWS.some((w) => w.key === v);

/** What the chosen window actually turned out to cover — resolved against the log rather than
 *  repeating the label's promise, which is the whole reason it is printed. */
const spanLabel = (w: CritWindow): string => {
  if (w.fromMs === null || w.toMs === null) return "nothing yet";
  const days = Math.round((w.toMs - w.fromMs) / 86400_000);
  const span = days >= 2 ? `${days} days` : hoursLabel(w.toMs - w.fromMs);
  const since = new Date(w.fromMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${span} · since ${since}`;
};

const hoursLabel = (ms: number): string => {
  const min = Math.round(ms / 60000);
  if (min < 90) return `${min} min`;
  return `${(min / 60).toFixed(1)} h`;
};

export function CritPanel({ crits }: { crits: CritStats }) {
  const [open, setOpen] = useState<CritCategory | null>(null);
  const [key, setKey] = useState<CritWindowKey>(() => {
    try {
      const saved = localStorage.getItem(WINDOW_KEY);
      return isWindowKey(saved) ? saved : "session";
    } catch {
      return "session"; // private mode, or storage disabled
    }
  });
  const [win, setWin] = useState<CritWindow | null>(null);
  const [failed, setFailed] = useState(false);

  // The windows are fetched, not pushed — together they weigh about as much as the whole
  // snapshot, for tables only this tab reads. So this polls while mounted rather than riding the
  // stream: a crit rate over 100 fights does not move perceptibly in four seconds, and the
  // badges and the recent-crits strip below *are* live off the snapshot.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/crits?w=${key}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as CritWindow;
        if (alive) {
          setWin(data);
          setFailed(false);
        }
      } catch {
        // An older server has no such route. Say so rather than showing an empty table that
        // reads as "you have never critted".
        if (alive) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);

  const choose = (k: CritWindowKey) => {
    setKey(k);
    setWin(null); // so the old window's numbers never sit under the new window's label
    try {
      localStorage.setItem(WINDOW_KEY, k);
    } catch {
      /* storage disabled */
    }
  };

  const chosen = WINDOWS.find((w) => w.key === key)!;
  const total = win ? win.categories.reduce((n, c) => n + c.crits, 0) : 0;
  const anyHits = win ? win.categories.some((c) => c.hits > 0) : false;
  const anyRecord = crits.records.some((r) => r.bestHit !== null);

  return (
    <section className="block crit-panel">
      <div className="section-title">
        Critical hits
        <span className="muted small crit-scope"> — yours alone</span>
      </div>

      {/* Records first, and outside the window entirely: "highest ever" is the one reading here
          that must not move when the window does. They come off the snapshot, so they stay live
          even while the tables below are between fetches. */}
      {anyRecord && (
        <div className="crit-records">
          {RECORD_CATEGORIES.map((cat) => {
            const r = crits.records.find((x) => x.category === cat);
            return r ? <RecordTile key={cat} c={r} /> : null;
          })}
        </div>
      )}

      <div className="crit-windows" role="tablist">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            role="tab"
            aria-selected={w.key === key}
            className={`crit-win ${w.key === key ? "on" : ""}`}
            title={w.note}
            onClick={() => choose(w.key)}
          >
            {w.label}
          </button>
        ))}
        <span className="crit-span muted">
          {win ? spanLabel(win) : failed ? "" : "…"}
          {win && win.encounters > 0 && ` · ${fmt(win.encounters)} fights`}
          {/* A window the log cannot fill is marked, so 12 fights are never read as 100. */}
          {win?.short && <span className="crit-short"> · all there is</span>}
        </span>
      </div>

      {failed ? (
        <div className="idle small">
          This server has no <code>/api/crits</code> — it is running an engine from before the
          window selector. Restart it to pick up the new build.
        </div>
      ) : !win ? (
        <div className="idle small">Loading {chosen.label.toLowerCase()}…</div>
      ) : !anyHits ? (
        <div className="idle">
          Nothing in this window yet — {chosen.note.charAt(0).toLowerCase() + chosen.note.slice(1)}
        </div>
      ) : (
        <>
          <div className="crit-cats">
            {win.categories.map((c) => (
              <CategoryBlock
                key={c.category}
                c={c}
                open={open === c.category}
                onToggle={() => setOpen(open === c.category ? null : c.category)}
              />
            ))}
          </div>

          {crits.recent.length > 0 && (
            <div className="crit-recent">
              <div className="crit-cap">
                Last {crits.recent.length} crits · {fmt(total)} in this window
              </div>
              {crits.recent.map((r) => (
                <div key={`${r.tsMs}-${r.ability}-${r.amount}`} className="crit-recent-row">
                  <span className="crit-when">{time(r.tsMs)}</span>
                  <RecordLine r={r} showCategory />
                </div>
              ))}
            </div>
          )}

          <div className="crit-note muted small">
            A rate divides by the times that form of attack actually dealt damage — misses,
            parries and ripostes are not failed crits and are not in the denominator. Crippling
            blows, slay-undead and finishing blows count: the game emits them <em>instead of</em>{" "}
            “Critical”, never alongside it. The badges above are all-time and ignore the window.
          </div>
        </>
      )}
    </section>
  );
}
