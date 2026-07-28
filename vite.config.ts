import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend lives in web/. Built assets go to web/dist, which the Node server serves.
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // During `npm run dev:web`, proxy API + SSE to the Node backend on :8787.
    proxy: {
      "/api": "http://localhost:8787",
      "/events": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
