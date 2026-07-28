// Package dist/eql-parser.cjs into a native single-file executable using Node's
// Single Executable Applications (SEA) feature. Produces dist/eql-parser (or
// eql-parser.exe on Windows) that runs with nothing else installed.
//
// Steps: generate the SEA blob, copy the node binary, inject the blob with
// postject, and (macOS) strip + re-apply an ad-hoc code signature.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const outName = isWin ? "eql-parser.exe" : "eql-parser";
const outPath = path.join(dist, outName);
const blobPath = path.join(dist, "sea-prep.blob");

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: root });
}

/** The SEA fuse sentinel varies by Node build; read it out of the binary. */
function detectFuse(file) {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf("NODE_SEA_FUSE_");
  if (at < 0) throw new Error("no SEA fuse in this Node build — SEA unsupported");
  const m = buf.slice(at, at + 96).toString("latin1").match(/NODE_SEA_FUSE_[0-9a-f]+/);
  if (!m) throw new Error("could not parse SEA fuse");
  return m[0];
}

const ARCH_TO_MACHO = { arm64: "arm64", x64: "x86_64" };

if (!fs.existsSync(path.join(dist, "eql-parser.cjs"))) {
  console.error("dist/eql-parser.cjs missing — run `npm run build` first.");
  process.exit(1);
}

// 1) Generate the SEA blob.
run(process.execPath, ["--experimental-sea-config", "sea-config.json"]);

// 2) Copy the running node binary as the base executable.
fs.copyFileSync(process.execPath, outPath);
if (!isWin) fs.chmodSync(outPath, 0o755);

// 3) macOS universal binaries break postject (fuse present in every slice) —
//    thin to the host architecture first.
if (isMac) {
  const archs = execFileSync("lipo", ["-archs", outPath]).toString().trim();
  if (archs.split(/\s+/).length > 1) {
    const target = ARCH_TO_MACHO[process.arch] ?? "arm64";
    console.log(`Thinning universal binary (${archs}) → ${target}`);
    run("lipo", [outPath, "-thin", target, "-output", outPath]);
  }
  try {
    run("codesign", ["--remove-signature", outPath]);
  } catch {
    /* unsigned already */
  }
}

// 4) Inject the blob with postject (fuse sentinel detected from the binary).
const fuse = detectFuse(outPath);
const postjectArgs = ["postject", outPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", fuse];
if (isMac) postjectArgs.push("--macho-segment-name", "NODE_SEA");
run("npx", postjectArgs);

// 5) macOS: re-apply an ad-hoc signature so Gatekeeper will run it locally.
if (isMac) run("codesign", ["--sign", "-", outPath]);

const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(1);
console.log(`\n✅ Built ${path.relative(root, outPath)} (${sizeMb} MB) — run it directly.`);
