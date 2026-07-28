// Web UI assets embedded at build time by scripts/build-standalone.mjs.
// Empty in source/dev (the server then serves web/dist from disk); populated
// only inside the bundled dist/eql-parser.cjs so it needs no sibling files.

export interface EmbeddedAsset {
  type: string;
  base64: string;
}

export const EMBEDDED_WEB: Record<string, EmbeddedAsset> = {};
