import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Tailer } from "./tailer.js";

function tmpFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eql-tail-"));
  const file = path.join(dir, "eqlog_Test_server.txt");
  fs.writeFileSync(file, contents);
  return file;
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("live mode: emits only lines appended after start, CRLF stripped", async () => {
  const file = tmpFile("old 1\r\nold 2\r\n");
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: false, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  fs.appendFileSync(file, "new A\r\nnew B\r\n");
  await waitFor(() => got.length >= 2);
  t.stop();
  assert.deepEqual(got, ["new A", "new B"]);
});

test("backfill mode: reads existing file then follows", async () => {
  const file = tmpFile("line 1\r\nline 2\r\n");
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: true, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  await waitFor(() => got.length >= 2);
  fs.appendFileSync(file, "line 3\r\n");
  await waitFor(() => got.length >= 3);
  t.stop();
  assert.deepEqual(got, ["line 1", "line 2", "line 3"]);
});

test("partial line is buffered until newline arrives", async () => {
  const file = tmpFile("");
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: false, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  fs.appendFileSync(file, "half of a line");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(got.length, 0, "no complete line yet");
  fs.appendFileSync(file, " and the rest\r\n");
  await waitFor(() => got.length >= 1);
  t.stop();
  assert.deepEqual(got, ["half of a line and the rest"]);
});

test("backfill spanning many read chunks emits every line, in order, exactly once", async () => {
  // Over the 1MB chunk size, so the read loop runs several times and lines land across the
  // boundaries. The whole-file read this replaced could not get a boundary wrong because it
  // had none; the risk moved here when it started reading in pieces.
  const lines = Array.from({ length: 60_000 }, (_, i) => `line ${i} ${"x".repeat(50)}`);
  const file = tmpFile(lines.join("\r\n") + "\r\n"); // ~3.5MB
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: true, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  await waitFor(() => got.length >= lines.length, 20000);
  t.stop();
  assert.deepEqual(got, lines, "same lines, same order, none split at a chunk edge");
});

test("a line longer than a read chunk survives being split across reads", async () => {
  // One line bigger than the buffer: it is *only* ever seen in pieces, so the pending buffer
  // has to carry it across two reads rather than emitting half of it.
  const long = `long ${"y".repeat(1 << 21)} end`; // 2MB, over the 1MB chunk
  const file = tmpFile(`before\r\n${long}\r\nafter\r\n`);
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: true, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  await waitFor(() => got.length >= 3, 10000);
  t.stop();
  assert.deepEqual(got, ["before", long, "after"]);
});

test("a multi-byte character split across a chunk boundary is decoded whole", async () => {
  // The log is effectively ASCII, so this is the assumption the decoder removes rather than a
  // case seen in the wild — but a chunk edge landing mid-character would corrupt a line
  // silently, which is the kind of thing worth a test rather than a comment.
  const pad = "z".repeat((1 << 20) - 2); // ends the first chunk two bytes short
  const file = tmpFile(`${pad}日本\r\ntail\r\n`);
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: true, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  await waitFor(() => got.length >= 2, 10000);
  t.stop();
  assert.deepEqual(got, [`${pad}日本`, "tail"]);
});

test("truncation/rotation resets and re-reads", async () => {
  const file = tmpFile("line one\r\nline two\r\nline three\r\n"); // 32 bytes
  const got: string[] = [];
  const t = new Tailer({ path: file, fromStart: false, pollIntervalMs: 30 });
  t.onData((l) => got.push(l));
  t.start();
  // Simulate a new session: file shrinks below the current offset.
  fs.writeFileSync(file, "fresh\r\n"); // 7 bytes < 32 -> truncation
  await waitFor(() => got.includes("fresh"));
  t.stop();
  assert.ok(got.includes("fresh"));
});
