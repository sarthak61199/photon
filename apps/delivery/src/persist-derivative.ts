import type { DbClient } from "@photon/db";
import { derivatives } from "@photon/db";
import type { StorageClient } from "@photon/storage";

export interface DerivativeMeta {
  assetId: string;
  transformKey: string;
}

export function persistDerivative(
  storage: StorageClient,
  db: DbClient,
  key: string,
  body: Buffer,
  contentType: string,
  meta: DerivativeMeta,
): void {
  void (async () => {
    await storage.put(key, body, { contentType });
    await db.db
      .insert(derivatives)
      .values({
        assetId: meta.assetId,
        transformKey: meta.transformKey,
        storageKey: key,
        bytes: body.length,
      })
      .onConflictDoNothing();
  })().catch((err: unknown) => {
    console.error(`delivery: failed to persist derivative ${key}`, err);
  });
}
