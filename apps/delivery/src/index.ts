import { serve } from "@hono/node-server";
import { app } from "./app";
import { getConfig } from "./config";
import { enqueueUsageEvents } from "./queue";
import { startUsageFlush } from "./usage";

const { port } = getConfig();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`delivery listening on :${info.port}`);
});

const stopUsageFlush = startUsageFlush(enqueueUsageEvents);

async function shutdown(): Promise<void> {
  await stopUsageFlush();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
