export interface DeliveryConfig {
  port: number;
  requireSignedUrls: boolean;
  signingKey: Buffer;
}

export function getConfig(): DeliveryConfig {
  return {
    port: Number(process.env.PORT ?? 8788),
    requireSignedUrls: process.env.DELIVERY_REQUIRE_SIGNED_URLS === "true",
    signingKey: Buffer.from(process.env.DELIVERY_SIGNING_KEY ?? "dev-signing-key"),
  };
}
