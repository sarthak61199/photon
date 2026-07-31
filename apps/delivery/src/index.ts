import { serve } from "@hono/node-server";
import { app } from "./app";
import { getConfig } from "./config";

const { port } = getConfig();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`delivery listening on :${info.port}`);
});
