import type { DbClient } from "@photon/db";
import { createDbClient } from "@photon/db";
import { getConfig } from "./config";

let client: DbClient | undefined;

export function getDbClient(): DbClient {
  client ??= createDbClient({ url: getConfig().databaseUrl });
  return client;
}
