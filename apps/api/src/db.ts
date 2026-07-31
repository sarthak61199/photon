import type { DbClient } from "@img/db";
import { createDbClient } from "@img/db";
import { getConfig } from "./config";

let client: DbClient | undefined;

export function getDbClient(): DbClient {
  client ??= createDbClient({ url: getConfig().databaseUrl });
  return client;
}
