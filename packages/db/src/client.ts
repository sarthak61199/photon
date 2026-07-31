import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface DbConfig {
  url: string;
  max?: number;
}

export interface DbClient {
  db: PostgresJsDatabase<typeof schema>;
  close(): Promise<void>;
}

export function createDbClient(config: DbConfig): DbClient {
  const client = postgres(config.url, { max: config.max ?? 10 });
  const db = drizzle(client, { schema });

  return {
    db,
    close: () => client.end(),
  };
}
