export interface ApiConfig {
  port: number;
  databaseUrl: string;
}

export function getConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? process.env.PORT ?? 8787),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/img",
  };
}
