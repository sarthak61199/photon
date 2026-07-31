import { serve } from "@hono/node-server";
import { app } from "./app";
import { getConfig } from "./config";
import { getQueue } from "./queue";

const { port } = getConfig();

// Best-effort warm start so the pg-boss schema/queue exist before the first
// real request needs them; getQueue() is idempotent so this doesn't race
// with a route handler also calling it.
void getQueue().catch((err) => console.error("failed to start pg-boss", err));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`);
});
