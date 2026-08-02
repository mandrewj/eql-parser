import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browseDir } from "./browse.js";

/** A throwaway tree:
 *      root/
 *        EverQuest Legends/logs/  eqlog_A_freeport.txt, eqlog_B_qeynos.txt, notes.txt
 *        EverQuest Legends/       Textures/
 *        empty/
 */
function tree(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eql-browse-"));
  const logs = path.join(root, "EverQuest Legends", "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(path.join(root, "EverQuest Legends", "Textures"));
  fs.mkdirSync(path.join(root, "empty"));
  fs.writeFileSync(path.join(logs, "eqlog_A_freeport.txt"), "");
  fs.writeFileSync(path.join(logs, "eqlog_B_qeynos.txt"), "");
  fs.writeFileSync(path.join(logs, "notes.txt"), "");
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("browse — lists sub-folders alphabetically and ignores files", () => {
  tree((root) => {
    const r = browseDir(root);
    assert.deepEqual(
      r.dirs.map((d) => d.name),
      ["empty", "EverQuest Legends"],
    );
    assert.equal(r.logs, 0); // no logs directly in root
  });
});

/** The count is what makes the picker quick — you are hunting for the one folder with logs in
 *  it, and being told which one that is beats recognising the name. */
test("browse — each sub-folder reports how many logs it holds", () => {
  tree((root) => {
    const eq = browseDir(path.join(root, "EverQuest Legends"));
    assert.deepEqual(
      eq.dirs.map((d) => [d.name, d.logs]),
      [
        ["logs", 2],
        ["Textures", 0],
      ],
    );
  });
});

test("browse — a folder reports its own log count, which is what confirms the choice", () => {
  tree((root) => {
    const r = browseDir(path.join(root, "EverQuest Legends", "logs"));
    assert.equal(r.logs, 2); // notes.txt is not an eqlog
    assert.deepEqual(r.dirs, []);
  });
});

test("browse — parent walks up, and is null at the filesystem root", () => {
  tree((root) => {
    const r = browseDir(path.join(root, "empty"));
    assert.equal(r.parent, root);
    assert.equal(browseDir(path.parse(root).root).parent, null);
  });
});

test("browse — an unreadable or missing folder reports an error rather than throwing", () => {
  const r = browseDir(path.join(os.tmpdir(), "eql-does-not-exist-" + Date.now()));
  assert.ok(r.error);
  assert.deepEqual(r.dirs, []);
  // Still names where it tried, so the UI has something to show and somewhere to go up to.
  assert.ok(r.path.length > 0);
  assert.ok(r.parent);
});

/** Symlinked directories are how a Wine bottle is often laid out, and `Dirent.isDirectory()`
 *  is false for them — skipping those would hide the install. */
test("browse — a symlinked directory is followed, a dangling one ignored", () => {
  tree((root) => {
    fs.symlinkSync(path.join(root, "EverQuest Legends"), path.join(root, "link-to-eq"), "dir");
    fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "broken"), "dir");
    const names = browseDir(root).dirs.map((d) => d.name);
    assert.ok(names.includes("link-to-eq"), "symlinked dir should be listed");
    assert.ok(!names.includes("broken"), "dangling link should not be");
  });
});

test("browse — with no directory given it opens where the app is pointed", () => {
  tree((root) => {
    const start = path.join(root, "EverQuest Legends", "logs");
    assert.equal(browseDir(null, start).path, start);
  });
});

test("browse — shortcuts are offered only for folders that exist", () => {
  tree((root) => {
    for (const s of browseDir(root).shortcuts) {
      assert.ok(fs.statSync(s.path).isDirectory(), `${s.label} → ${s.path} should exist`);
    }
  });
});

/** Windows has no single root — `dirname("C:\\")` is `C:\\` — so walking up can never leave the
 *  drive the picker opened on. Drive shortcuts are the only way to reach a game installed on D:.
 *  The probe itself is win32-only and cannot run here; what is checked is that a root is
 *  correctly recognised as having no parent, which is the behaviour that creates the need. */
test("browse — a filesystem root has no parent, which is why drives are offered", () => {
  const root = path.parse(process.cwd()).root;
  assert.equal(browseDir(root).parent, null);
});

test("browse — a start folder that does not exist is skipped rather than opened on", () => {
  const missing = path.join(os.tmpdir(), "eql-not-here-" + Date.now());
  const r = browseDir(null, missing);
  assert.notEqual(r.path, missing);
  assert.equal(r.error, undefined, "should have landed somewhere readable");
});

/** An explicitly requested folder is still reported as missing — that is information, where
 *  silently redirecting would leave a mistyped path looking like it had worked. */
test("browse — an explicitly requested missing folder still reports the error", () => {
  const missing = path.join(os.tmpdir(), "eql-not-here-" + Date.now());
  const r = browseDir(missing);
  assert.equal(r.path, missing);
  assert.ok(r.error);
});
