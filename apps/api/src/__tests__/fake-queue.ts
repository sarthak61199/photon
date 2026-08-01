export interface FakeSentJob {
  name: string;
  data: unknown;
}

export interface FakeQueue {
  sent: FakeSentJob[];
  clear(): void;
}

export const fakeQueue: FakeQueue = {
  sent: [],
  clear() {
    fakeQueue.sent.length = 0;
  },
};

export async function enqueueProcessAsset(assetId: string): Promise<void> {
  fakeQueue.sent.push({ name: "process-asset", data: { assetId } });
}

export async function enqueueFetchUrl(assetId: string, url: string): Promise<void> {
  fakeQueue.sent.push({ name: "fetch-url", data: { assetId, url } });
}

export async function enqueuePurgeAsset(assetId: string): Promise<void> {
  fakeQueue.sent.push({ name: "purge-asset", data: { assetId } });
}
