import { useCallback, useEffect, useState } from "react";

/** A folder chooser that reports a real path.
 *
 *  The browser's own choosers cannot: `showDirectoryPicker()` returns an opaque handle and
 *  `<input webkitdirectory>` returns paths relative to the folder you picked. Both withhold the
 *  absolute path on purpose, and the absolute path is the only thing the backend can use. So the
 *  directory listing comes from `/api/browse` and this renders it.
 *
 *  It is built around the one question being asked — *which folder holds the logs* — so every row
 *  carries its `eqlog_*.txt` count and the confirm button is only encouraging when the current
 *  folder has some. Typing a path still works; this sits beside that rather than replacing it,
 *  because a path pasted from somewhere else is quicker than navigating to it.
 */

interface BrowseEntry {
  name: string;
  logs: number | null;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: BrowseEntry[];
  logs: number;
  shortcuts: Array<{ label: string; path: string }>;
  error?: string;
}

/** The chrome and the list, with no idea where the data came from. Split out so the panel can be
 *  rendered — and screenshotted — from a fixed listing: the live app holds an SSE connection open,
 *  which stops headless Chrome ever reaching a settled state to photograph. */
export function FolderList({
  view,
  loading,
  onGo,
  onPick,
  onClose,
}: {
  view: BrowseResult | null;
  loading: boolean;
  onGo: (dir: string) => void;
  onPick: (dir: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="pickwrap" role="dialog" aria-label="Select the folder containing your EverQuest Legends character logs">
      <div className="pickhead">
        <PathLabel path={view?.path ?? null} />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className={view && view.logs > 0 ? "btn primary" : "btn"}
          disabled={!view}
          onClick={() => view && onPick(view.path)}
          title={
            view?.logs
              ? `Read logs from this folder — ${view.logs} character log${view.logs === 1 ? "" : "s"} found in it`
              : "This folder holds no eqlog_*.txt files. You can still use it, but no character will be found until one appears here."
          }
        >
          Use this folder
          {view && view.logs > 0 && <span className="pickn">{view.logs}</span>}
        </button>
      </div>

      {/* The picker asks for one specific thing and should say so. "Choose a folder" leaves you
          guessing between the game folder, the install root and the logs folder itself — and the
          right answer is the one *containing* the eqlog files, not the game directory above it. */}
      <div className="pickhelp">
        Select the folder that <strong>contains your log files</strong> — the ones named{" "}
        <code>eqlog_&lt;Character&gt;_&lt;server&gt;.txt</code>. It is usually{" "}
        <code>…/EverQuest Legends/Logs</code>. A count beside a folder means logs are in it.
      </div>

      {view?.shortcuts && view.shortcuts.length > 0 && (
        <div className="pickshort">
          {view.shortcuts.map((s) => (
            <button key={s.path} className="chip" onClick={() => onGo(s.path)} title={s.path}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="picklist">
        {view?.error && <div className="pickerr">{view.error}</div>}
        {view?.parent && (
          <button className="pickrow up" onClick={() => onGo(view.parent!)} title="Go up one folder">
            <span className="pickicon">↑</span>
            <span className="pickname">.. (up one folder)</span>
          </button>
        )}
        {view?.dirs.map((d) => (
          <button
            key={d.name}
            className={d.logs ? "pickrow has" : "pickrow"}
            onClick={() => onGo(joinPath(view.path, d.name))}
            title={
              d.logs
                ? `${d.logs} character log${d.logs === 1 ? "" : "s"} in here — this is probably the folder you want`
                : "No character logs directly in this folder — open it to look further in"
            }
          >
            <span className="pickicon">{d.logs ? "▣" : "▢"}</span>
            <span className="pickname">{d.name}</span>
            {d.logs ? <span className="pickn">{d.logs}</span> : null}
          </button>
        ))}
        {view && !view.error && view.dirs.length === 0 && (
          <div className="pickerr">
            {view.logs > 0
              ? "No sub-folders — this folder holds your logs, so use it."
              : "No sub-folders and no logs here. Go back up and try another folder."}
          </div>
        )}
        {loading && !view && <div className="pickerr">Loading…</div>}
      </div>
    </div>
  );
}

/** Which separator a path is built from. The backend decides that, not the browser, so it is
 *  read off the path itself rather than guessed from the client's platform. Stated once: the
 *  label and the join both need it, and disagreeing would corrupt one of them. */
function separatorOf(p: string): string {
  return p.includes("\\") && !p.includes("/") ? "\\" : "/";
}

/** The current path, truncated in the middle rather than at either end.
 *
 *  The last segment is the answer to "where am I" and must never be cut; the head is context and
 *  can be. `direction: rtl` is the usual one-line trick for this and is wrong here — it treats the
 *  leading `/` of an absolute path as neutral punctuation and reorders it to the far end, so
 *  `/Users/andrew/…` renders as `…/andrew/…/` with a slash that is not in the path. Splitting the
 *  string and letting only the head shrink keeps the characters in the order they were written. */
function PathLabel({ path }: { path: string | null }) {
  if (!path) return <span className="pickpath">…</span>;
  const cut = path.lastIndexOf(separatorOf(path));
  const head = cut > 0 ? path.slice(0, cut) : "";
  const tail = cut > 0 ? path.slice(cut) : path;
  return (
    <span className="pickpath" title={path}>
      <span className="pickpath-head">{head}</span>
      <span className="pickpath-tail">{tail}</span>
    </span>
  );
}

/** Join for display and for the next request. The server resolves properly; this only has to
 *  produce something it can parse. */
function joinPath(base: string, name: string): string {
  const sep = separatorOf(base);
  return base.endsWith(sep) ? base + name : base + sep + name;
}

/** The stateful half: fetches, and keeps the last good listing if a request fails. */
export function FolderPicker({ onPick, onClose }: { onPick: (dir: string) => void; onClose: () => void }) {
  const [view, setView] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);

  const go = useCallback(async (dir: string | null) => {
    setLoading(true);
    try {
      const q = dir === null ? "" : `?dir=${encodeURIComponent(dir)}`;
      setView((await fetch(`/api/browse${q}`).then((r) => r.json())) as BrowseResult);
    } catch {
      /* server went away; keep the last listing rather than blanking the panel */
    } finally {
      setLoading(false);
    }
  }, []);

  // Opens where the app is already pointed, so the common case is confirming rather than hunting.
  useEffect(() => {
    void go(null);
  }, [go]);

  // Escape closes, as it would for any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <FolderList view={view} loading={loading} onGo={(d) => void go(d)} onPick={onPick} onClose={onClose} />;
}
