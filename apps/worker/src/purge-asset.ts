import { derivatives } from "@photon/db";
import { eq } from "drizzle-orm";
import { getDbClient } from "./db";
import { getStorageClient } from "./storage";

export interface PurgeAssetJob {
  data: { assetId: string };
}

// Best-effort: an individual object failing to delete (e.g. already gone)
// logs and continues rather than failing the whole job, since a purge is
// cleanup, not a delivery guarantee.
export async function purgeAsset(job: PurgeAssetJob): Promise<void> {
  const { assetId } = job.data;
  const { db } = getDbClient();
  const storage = getStorageClient();

  const asset = await db.query.assets.findFirst({
    where: (a, { eq: eqCol }) => eqCol(a.id, assetId),
  });
  if (!asset) {
    console.warn(`worker: purge-asset skipped, asset not found: ${assetId}`);
    return;
  }

  const derivativeRows = await db.query.derivatives.findMany({
    where: (d, { eq: eqCol }) => eqCol(d.assetId, assetId),
  });

  await Promise.all(
    derivativeRows.map((row) =>
      storage.delete(row.storageKey).catch((err: unknown) => {
        console.error(`worker: purge-asset failed to delete derivative ${row.storageKey}`, err);
      }),
    ),
  );

  await db.delete(derivatives).where(eq(derivatives.assetId, assetId));

  await storage.delete(asset.storageKey).catch((err: unknown) => {
    console.error(`worker: purge-asset failed to delete original ${asset.storageKey}`, err);
  });
}
