import type { StorageClient } from "@photon/storage";

export function persistDerivative(
  storage: StorageClient,
  key: string,
  body: Buffer,
  contentType: string,
): void {
  void storage.put(key, body, { contentType }).catch((err: unknown) => {
    console.error(`delivery: failed to persist derivative ${key}`, err);
  });
}
