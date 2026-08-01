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
