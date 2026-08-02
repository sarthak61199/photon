import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export interface DeliveryConfig {
  port: number;
  databaseUrl: string;
}

export function getConfig(): DeliveryConfig {
  return {
    port: Number(process.env.DELIVERY_PORT ?? process.env.PORT ?? 8788),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon",
  };
}
