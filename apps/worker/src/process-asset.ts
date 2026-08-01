import { createHash } from "node:crypto";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { assets } from "@photon/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDbClient } from "./db";
import { getStorageClient } from "./storage";
import { deliverEvent } from "./webhooks";

const MAX_INPUT_PIXELS = 268_402_689; // ~16k x 16k, sharp's own decompression-bomb default, set explicitly

export interface ProcessAssetJob {
  data: { assetId: string };
}

export async function processAsset(job: ProcessAssetJob): Promise<void> {
  const { assetId } = job.data;
  const { db } = getDbClient();

  const asset = await db.query.assets.findFirst({
    where: (a, { eq: eqCol, and, isNull }) => and(eqCol(a.id, assetId), isNull(a.deletedAt)),
  });
  if (!asset) {
    console.warn(`worker: process-asset skipped, asset not found: ${assetId}`);
    return;
  }

  try {
    const storage = getStorageClient();
    const { stream, contentType } = await storage.get(asset.storageKey);
    const buf = await streamToBuffer(stream);

    const checksum = createHash("sha256").update(buf).digest("hex");
    const meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.width || !meta.height || !meta.format) {
      throw new Error("decoded image is missing width, height, or format");
    }

    await db
      .update(assets)
      .set({
        status: "ready",
        mimeType: contentType ?? `image/${meta.format}`,
        bytes: buf.length,
        width: meta.width,
        height: meta.height,
        checksum,
      })
      .where(eq(assets.id, assetId));

    await deliverEvent(getDbClient(), asset.orgId, "asset.ready", {
      assetId: asset.id,
      publicId: asset.publicId,
      status: "ready",
      width: meta.width,
      height: meta.height,
      bytes: buf.length,
    });
  } catch (err) {
    console.error(`worker: process-asset failed for ${assetId}`, err);

    await db.update(assets).set({ status: "failed" }).where(eq(assets.id, assetId));

    await deliverEvent(getDbClient(), asset.orgId, "asset.failed", {
      assetId: asset.id,
      publicId: asset.publicId,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
