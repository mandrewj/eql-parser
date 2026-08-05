import { useState } from "react";
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
import type { CritAbility, CritCategory, CritCategoryStat, CritKind, CritRecord, CritStats } from "./types";

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

/** A record, as one line: how big, what did it, and to whom. */
function RecordLine({ r, showCategory = false }: { r: CritRecord; showCategory?: boolean }) {
  return (
    // The ability and target both ellipsise on a narrow panel, so the full text has to survive
    // somewhere — long spell names ("Tuyen's Chant of Flame VI") are exactly the ones that trim.
    <span className="crit-rec" title={`${fmt(r.amount)} — ${r.ability} on ${r.target} · ${KIND_LABEL[r.kind]} · ${time(r.tsMs)}`}>
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
                <span className="crit-abar">biggest</span>
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

export function CritPanel({ crits }: { crits: CritStats }) {
  const [open, setOpen] = useState<CritCategory | null>(null);
  const total = crits.categories.reduce((n, c) => n + c.crits, 0);
  const anyHits = crits.categories.some((c) => c.hits > 0);

  return (
    <section className="block crit-panel">
      <div className="section-title">
        Critical hits
        <span className="muted small crit-scope">
          {" "}
          — yours alone, over the whole session
        </span>
      </div>

      {!anyHits ? (
        <div className="idle">
          No hits recorded yet — the ledger fills as you fight.
        </div>
      ) : (
        <>
          <div className="crit-cats">
            {crits.categories.map((c) => (
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
                Last {crits.recent.length} crits · {fmt(total)} this session
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
            “Critical”, never alongside it.
          </div>
        </>
      )}
    </section>
  );
}
