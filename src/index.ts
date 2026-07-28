// Entry point: resolve config + logs, start the local server, print status.

import { loadConfig, listLogs } from "./config.js";
import { startServer, type RuntimeState } from "./server/server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("EQL Parser — starting");
  console.log("---------------------");

  if (!config.logDir) {
    console.log("⚠  No EverQuest Legends log directory found.");
    console.log("   Set EQL_LOG_DIR to your logs folder, e.g.:");
    console.log('   export EQL_LOG_DIR="/path/to/EverQuest Legends/logs"');
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
      const who = log.character ? `${log.character} (${log.server ?? "?"})` : "unknown char";
      const kb = (log.sizeBytes / 1024).toFixed(0);
      console.log(`  ${marker} ${log.fileName}  —  ${who}, ${kb} KB`);
    }
  }

  const state: RuntimeState = {
    activeLogPath: active?.path ?? null,
    mode: "live",
  };

  const server = await startServer(config, state);
  console.log("---------------------");
  console.log(`Open ${server.url} in your browser`);
  if (active) {
    console.log(`Active log    : ${active.character ?? active.fileName}`);
  }

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
