import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export interface ApiConfig {
  port: number;
  databaseUrl: string;
}

export function getConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 8787),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon",
  };
}
