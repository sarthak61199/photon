export interface WorkerConfig {
  databaseUrl: string;
}

export function getConfig(): WorkerConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon",
  };
}
