// Minimal local HTTP server: static SPA + JSON control API + SSE stream.
// M0 wires the log-picker endpoints and the SSE channel; the engine/tailer
// plug into `broadcaster` in later milestones.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import { listLogs } from "../config.js";
import type { ParseMode } from "../types.js";

export interface RuntimeState {
  activeLogPath: string | null;
  mode: ParseMode;
}

export interface Broadcaster {
  /** Push a JSON event to every connected SSE client. */
  send(event: unknown): void;
  clientCount(): number;
}

export interface ServerHandle {
  broadcaster: Broadcaster;
  close(): Promise<void>;
  url: string;
}

const WEB_DIR = fileURLToPath(new URL("../../web", import.meta.url));

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

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(WEB_DIR, rel);
  // Prevent path traversal outside WEB_DIR.
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    });
    res.end(data);
  });
}

export function startServer(config: AppConfig, state: RuntimeState): Promise<ServerHandle> {
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

    // --- JSON API -------------------------------------------------------
    if (pathname === "/api/logs" && req.method === "GET") {
      const logs = config.logDir ? listLogs(config.logDir) : [];
      sendJson(res, 200, { logDir: config.logDir, activeLogPath: state.activeLogPath, logs });
      return;
    }

    if (pathname === "/api/logs/active" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          path?: string;
          mode?: ParseMode;
        };
        if (!body.path) {
          sendJson(res, 400, { error: "missing 'path'" });
          return;
        }
        state.activeLogPath = body.path;
        if (body.mode) state.mode = body.mode;
        // Tailer switching is wired in M3; announce the change for now.
        broadcaster.send({ t: "activeLogChanged", path: state.activeLogPath, mode: state.mode });
        sendJson(res, 200, { ok: true, activeLogPath: state.activeLogPath, mode: state.mode });
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" });
      }
      return;
    }

    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, config);
      return;
    }

    // --- SSE stream -----------------------------------------------------
    if (pathname === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`retry: 2000\n\n`);
      const logs = config.logDir ? listLogs(config.logDir) : [];
      res.write(
        `data: ${JSON.stringify({
          t: "hello",
          activeLogPath: state.activeLogPath,
          logCount: logs.length,
        })}\n\n`,
      );
      sseClients.add(res);
      const keepAlive = setInterval(() => res.write(`: ping\n\n`), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }

    // --- Static SPA -----------------------------------------------------
    serveStatic(res, pathname);
  });

  return new Promise((resolve) => {
    server.listen(config.port, "127.0.0.1", () => {
      resolve({
        broadcaster,
        url: `http://localhost:${config.port}`,
        close: () =>
          new Promise<void>((res) => {
            for (const client of sseClients) client.end();
            server.close(() => res());
          }),
      });
    });
  });
}
