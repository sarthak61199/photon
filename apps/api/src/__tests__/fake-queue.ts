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
