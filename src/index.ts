// Entry point: build the App, start the server, begin tailing the active log.

import { loadConfig, listLogs } from "./config.js";
import { App } from "./app.js";
import { startServer } from "./server/server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("EQL Parser — starting");
  console.log("---------------------");

  if (!config.logDir) {
    console.log("⚠  No EverQuest Legends log directory found.");
    console.log('   Set EQL_LOG_DIR, e.g.: export EQL_LOG_DIR="/path/to/EverQuest Legends/logs"');
  } else {
    console.log(`Log directory : ${config.logDir}`);
  }

  const logs = config.logDir ? listLogs(config.logDir) : [];
  const active = logs[0] ?? null;
  if (logs.length === 0) {
    console.log("Detected logs : (none)");
  } else {
    console.log(`Detected logs : ${logs.length}`);
    for (const log of logs) {
      const marker = log === active ? "→" : " ";
      const who = log.character ? `${log.character} (${log.server ?? "?"})` : "unknown";
      console.log(`  ${marker} ${log.fileName}  —  ${who}, ${(log.sizeBytes / 1024).toFixed(0)} KB`);
    }
  }

  const app = new App(config);
  const server = await startServer(config, app);
  app.setUpdateHandler(() => server.broadcaster.send({ t: "snapshot", ...app.snapshot() }));

  if (active) {
    app.setActiveLog(active.path, "backfill");
    console.log(`Active log    : ${active.character ?? active.fileName} (backfilled + live)`);
  }

  console.log("---------------------");
  console.log(`Open ${server.url} in your browser`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
