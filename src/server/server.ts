// Minimal local HTTP server: static SPA + JSON control API + SSE stream.
// All state lives in the App controller; the server is a thin transport.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import type { App } from "../app.js";
import type { CritWindowKey, ParseMode } from "../types.js";

/** The windows `/api/crits` will build. Listed here so an unknown one is a 400 rather than a
 *  silently-empty table. */
const CRIT_WINDOW_KEYS: CritWindowKey[] = ["session", "enc25", "enc100", "d14"];
import { EMBEDDED_WEB } from "./web-assets.js";
import { SKY_CLASSES } from "../parser/sky-catalogue.js";
import { browseDir } from "./browse.js";

export interface Broadcaster {
  send(event: unknown): void;
  clientCount(): number;
}

export interface ServerHandle {
  broadcaster: Broadcaster;
  close(): Promise<void>;
  url: string;
}

// In dev (ESM) this resolves to <repo>/web/dist. In the bundled CJS, import.meta.url
// is empty, so we fall back to cwd — the bundle serves embedded assets regardless.
const WEB_DIR = ((): string => {
  try {
    return fileURLToPath(new URL("../../web/dist", import.meta.url));
  } catch {
    return path.resolve(process.cwd(), "web/dist");
  }
})();

const DEV_HINT = `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#14161a;color:#e6e8eb;padding:2rem">
<h2>EQL Parser — UI not built yet</h2>
<p>Run <code>npm run build:web</code> (or <code>npm run dev</code>), then reload.</p>
<p>For UI development with hot-reload: <code>npm run dev:web</code> (serves on :5173, proxies the API here).</p></body>`;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Vite fingerprints everything under assets/, so those are safe to cache forever.
 *  Everything else — index.html above all — must never be cached: it names the current
 *  bundle by hash, and a stale copy asks for a bundle that a rebuild has already deleted
 *  (404 → blank page until a hard reload). */
function cacheControl(rel: string): string {
  return rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store";
}

/** Serve an embedded (bundled) asset if present. Returns true if it handled the response. */
function serveEmbedded(res: http.ServerResponse, key: string): boolean {
  const asset = EMBEDDED_WEB[key];
  if (!asset) return false;
  res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": cacheControl(key) });
  res.end(Buffer.from(asset.base64, "base64"));
  return true;
}

function serveIndex(res: http.ServerResponse): void {
  if (serveEmbedded(res, "index.html")) return;
  const head = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  fs.readFile(path.join(WEB_DIR, "index.html"), (err, html) => {
    if (err) {
      res.writeHead(200, head).end(DEV_HINT);
      return;
    }
    res.writeHead(200, head).end(html);
  });
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (serveEmbedded(res, rel)) return;

  const filePath = path.join(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // No extension → SPA route; serve index.html. Otherwise a real 404.
      if (!path.extname(rel)) return serveIndex(res);
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": cacheControl(rel),
    });
    res.end(data);
  });
}

export function startServer(config: AppConfig, app: App): Promise<ServerHandle> {
  const sseClients = new Set<http.ServerResponse>();

  const broadcaster: Broadcaster = {
    send(event: unknown) {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of sseClients) client.write(line);
    },
    clientCount: () => sseClients.size,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    if (pathname === "/api/logs" && req.method === "GET") {
      sendJson(res, 200, app.logs());
      return;
    }

    if (pathname === "/api/log-dir" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as { dir?: string };
        if (!body.dir) return sendJson(res, 400, { error: "missing 'dir'" });
        const result = app.setLogDir(body.dir);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        broadcaster.send({ t: "activeLogChanged", path: app.getActiveLogPath() });
        return sendJson(res, 200, app.logs());
      } catch {
        return sendJson(res, 400, { error: "invalid JSON body" });
      }
    }

    if (pathname === "/api/logs/active" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as { path?: string; mode?: ParseMode };
        if (!body.path) return sendJson(res, 400, { error: "missing 'path'" });
        app.setActiveLog(body.path, body.mode ?? "backfill");
        broadcaster.send({ t: "activeLogChanged", path: body.path, mode: body.mode ?? "backfill" });
        return sendJson(res, 200, { ok: true, activeLogPath: app.getActiveLogPath() });
      } catch {
        return sendJson(res, 400, { error: "invalid JSON body" });
      }
    }

    if (pathname === "/api/fights" && req.method === "GET") {
      sendJson(res, 200, { fights: app.fightSummaries() });
      return;
    }

    const fightMatch = /^\/api\/fights\/(.+)$/.exec(pathname);
    if (fightMatch && req.method === "GET") {
      const fight = app.fight(decodeURIComponent(fightMatch[1]!));
      if (!fight) return sendJson(res, 404, { error: "no such fight" });
      return sendJson(res, 200, fight);
    }

    if (pathname === "/api/snapshot" && req.method === "GET") {
      sendJson(res, 200, app.snapshot());
      return;
    }

    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, config);
      return;
    }

    // Directory listing for the logs-folder picker. A browser cannot supply an absolute path
    // from its own folder chooser, so the browsing happens server-side and the UI renders it.
    // `dir` omitted means "open where the app is already pointed".
    if (pathname === "/api/browse" && req.method === "GET") {
      const dir = url.searchParams.get("dir");
      sendJson(res, 200, browseDir(dir, app.logs().logDir));
      return;
    }

    // The Plane of Sky catalogue: 28KB of game facts that never change while the process runs.
    // Served once and cached hard rather than folded into the snapshot, which would otherwise
    // carry it again on every push for a third more bytes and no more information.
    if (pathname === "/api/sky-quests" && req.method === "GET") {
      res.setHeader("Cache-Control", "public, max-age=3600");
      sendJson(res, 200, SKY_CLASSES);
      return;
    }

    // The crit windows, on request rather than on every push. The four together weigh about as
    // much as the whole snapshot, for tables one tab reads — the same reasoning that keeps the
    // Sky catalogue out of the stream. Explicitly uncached: unlike the catalogue, this changes
    // as you fight.
    if (pathname === "/api/crits" && req.method === "GET") {
      const key = url.searchParams.get("w") ?? "session";
      if (!CRIT_WINDOW_KEYS.includes(key as CritWindowKey)) {
        return sendJson(res, 400, { error: `unknown window: ${key}` });
      }
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, app.critWindow(key as CritWindowKey));
      return;
    }

    if (pathname === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`retry: 2000\n\n`);
      res.write(`data: ${JSON.stringify({ t: "snapshot", ...app.snapshot() })}\n\n`);
      sseClients.add(res);
      const keepAlive = setInterval(() => res.write(`: ping\n\n`), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }

    serveStatic(res, pathname);
  });

  return new Promise((resolve) => {
    server.listen(config.port, "127.0.0.1", () => {
      resolve({
        broadcaster,
        url: `http://localhost:${config.port}`,
        close: () =>
          new Promise<void>((r) => {
            for (const client of sseClients) client.end();
            server.close(() => r());
          }),
      });
    });
  });
}
