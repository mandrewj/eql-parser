import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../app.js";
import { startServer, type ServerHandle } from "./server.js";
import type { AppConfig } from "../config.js";

/** A real server on an ephemeral port. The route takes the process down in production, so the
 *  test wires a spy in its place — what is under test is who may reach it, not `process.exit`. */
async function withServer(
  onShutdown: (() => void) | undefined,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const port = 49152 + Math.floor(Math.random() * 16000);
  const config = { port, logDir: null, inactivityTimeoutSec: 90 } as unknown as AppConfig;
  let handle: ServerHandle | null = null;
  try {
    handle = await startServer(config, new App(config), onShutdown);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await handle?.close();
  }
}

/** The guard that matters. This server sends no CORS headers, so requiring a JSON content type
 *  forces a preflight that can never be answered — which is what stops a page you merely visited
 *  from posting a form at localhost and stopping your parser. A simple POST has to be refused
 *  *without* stopping anything, or the refusal is theatre. */
test("shutdown — a request that could come cross-origin is refused, and stops nothing", async () => {
  let asked = 0;
  await withServer(
    () => asked++,
    async (base) => {
      for (const init of [
        { method: "POST" },
        { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" },
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" },
      ] as RequestInit[]) {
        const res = await fetch(`${base}/api/shutdown`, init);
        assert.equal(res.status, 415, `${JSON.stringify(init.headers ?? {})} should be refused`);
      }
      assert.equal(asked, 0, "and none of them asked the process to stop");
    },
  );
});

test("shutdown — a JSON post from the panel is accepted and asks once", async () => {
  let asked = 0;
  await withServer(
    () => asked++,
    async (base) => {
      const res = await fetch(`${base}/api/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      // Fired from `finish`, so the reply is already out — give the event loop a turn to run it.
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(asked, 1);
    },
  );
});

/** `charset=utf-8` is what `fetch` and most clients actually send, so an exact-match check would
 *  reject the panel's own request. */
test("shutdown — a charset on the content type is still JSON", async () => {
  let asked = 0;
  await withServer(
    () => asked++,
    async (base) => {
      const res = await fetch(`${base}/api/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: "{}",
      });
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(asked, 1);
    },
  );
});

/** GET is what a stray link, a prefetch or an `<img src>` would use — the shapes that need no
 *  cooperation from the user at all. It falls through to the static handler, which answers the SPA
 *  shell for any unknown path; the status is beside the point, and what is asserted is that
 *  nothing was asked to stop. */
test("shutdown — GET is not a way to stop the server", async () => {
  let asked = 0;
  await withServer(
    () => asked++,
    async (base) => {
      const res = await fetch(`${base}/api/shutdown`);
      assert.ok(!(await res.text()).includes('"ok":true'), "no shutdown acknowledgement");
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(asked, 0, "a GET must never reach the shutdown path");
    },
  );
});

test("shutdown — with nothing wired to stop, the route says so instead of pretending", async () => {
  await withServer(undefined, async (base) => {
    const res = await fetch(`${base}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 501);
  });
});
