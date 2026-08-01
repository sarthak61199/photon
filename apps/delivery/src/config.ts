export interface DeliveryConfig {
  port: number;
  requireSignedUrls: boolean;
  signingKey: Buffer;
  databaseUrl: string;
}

export function getConfig(): DeliveryConfig {
  return {
    port: Number(process.env.DELIVERY_PORT ?? process.env.PORT ?? 8788),
    requireSignedUrls: process.env.DELIVERY_REQUIRE_SIGNED_URLS === "true",
    signingKey: Buffer.from(process.env.DELIVERY_SIGNING_KEY ?? "dev-signing-key"),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon",
  };
}
