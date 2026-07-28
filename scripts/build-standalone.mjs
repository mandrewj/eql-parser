// Bundle the backend into a single self-contained dist/eql-parser.cjs with the
// built web UI (web/dist) embedded, so it runs anywhere Node is present with no
// sibling files. Run `npm run build:web` first (or use `npm run build`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distWeb = path.join(root, "web", "dist");
const assetsFile = path.join(root, "src", "server", "web-assets.ts");

const EMPTY_ASSETS = `// Web UI assets embedded at build time by scripts/build-standalone.mjs.
// Empty in source/dev (the server then serves web/dist from disk); populated
// only inside the bundled dist/eql-parser.cjs so it needs no sibling files.

export interface EmbeddedAsset {
  type: string;
  base64: string;
}

export const EMBEDDED_WEB: Record<string, EmbeddedAsset> = {};
`;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const key = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(full, key));
    else out.push({ key, full });
  }
  return out;
}

if (!fs.existsSync(distWeb)) {
  console.error("web/dist not found — run `npm run build:web` first.");
  process.exit(1);
}

const map = {};
for (const { key, full } of walk(distWeb)) {
  const ext = path.extname(full).toLowerCase();
  map[key] = { type: CONTENT_TYPES[ext] ?? "application/octet-stream", base64: fs.readFileSync(full).toString("base64") };
}
console.log(`Embedding ${Object.keys(map).length} web asset(s)…`);

const populated = `export interface EmbeddedAsset { type: string; base64: string; }
export const EMBEDDED_WEB: Record<string, EmbeddedAsset> = ${JSON.stringify(map)};
`;

fs.writeFileSync(assetsFile, populated);
try {
  await esbuild.build({
    entryPoints: [path.join(root, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(root, "dist", "eql-parser.cjs"),
    minify: true,
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "info",
  });
} finally {
  fs.writeFileSync(assetsFile, EMPTY_ASSETS); // keep the working tree clean
}

const sizeKb = (fs.statSync(path.join(root, "dist", "eql-parser.cjs")).size / 1024).toFixed(0);
console.log(`Built dist/eql-parser.cjs (${sizeKb} KB) — run: node dist/eql-parser.cjs`);
