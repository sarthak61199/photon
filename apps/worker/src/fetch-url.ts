import { assertPublicHttpUrl } from "@photon/core";
import { assets } from "@photon/db";
import { eq } from "drizzle-orm";
import { getDbClient } from "./db";
import { processAsset } from "./process-asset";
import { getStorageClient } from "./storage";
import { enqueueWebhookEvent } from "./webhooks";

const MAX_FETCH_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchUrlJob {
  data: { assetId: string; url: string };
}

// Follows redirects manually (rather than fetch's built-in follow) so every
// hop gets the same SSRF check as the original URL — see design doc §8:
// "disallow redirects to [private ranges] too".
async function downloadImage(initialUrl: string): Promise<Buffer> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicHttpUrl(currentUrl);
    const res = await fetch(currentUrl, { redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`redirect from ${currentUrl} had no Location header`);
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`fetch of ${currentUrl} failed with status ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`fetch of ${currentUrl} returned no body`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_FETCH_BYTES) {
        throw new Error(`fetched image from ${currentUrl} exceeds ${MAX_FETCH_BYTES} bytes`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  throw new Error(`too many redirects fetching ${initialUrl}`);
}

export async function fetchUrl(job: FetchUrlJob): Promise<void> {
  const { assetId, url } = job.data;
  const { db } = getDbClient();

  const asset = await db.query.assets.findFirst({
    where: (a, { eq: eqCol, and, isNull }) => and(eqCol(a.id, assetId), isNull(a.deletedAt)),
  });
  if (!asset) {
    console.warn(`worker: fetch-url skipped, asset not found: ${assetId}`);
    return;
  }

  try {
    const buf = await downloadImage(url);
    await getStorageClient().put(asset.storageKey, buf);
  } catch (err) {
    console.error(`worker: fetch-url failed for ${assetId}`, err);

    await db.update(assets).set({ status: "failed" }).where(eq(assets.id, assetId));

    await enqueueWebhookEvent(getDbClient(), asset.orgId, "asset.failed", {
      assetId: asset.id,
      publicId: asset.publicId,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Reuse process-asset's validation/metadata/webhook logic rather than
  // duplicating it — the downloaded bytes now sit at asset.storageKey exactly
  // like a completed presigned upload would.
  await processAsset({ data: { assetId } });
}
