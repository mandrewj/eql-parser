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
