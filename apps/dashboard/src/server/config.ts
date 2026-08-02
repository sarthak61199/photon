import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

export interface DashboardConfig {
  port: number;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
}

export function getConfig(): DashboardConfig {
  const port = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 3000);
  return {
    port,
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon",
    betterAuthSecret:
      process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me-0123456789",
    betterAuthUrl: process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`,
  };
}
