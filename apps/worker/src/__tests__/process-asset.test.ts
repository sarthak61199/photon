import { Readable } from "node:stream";
import type { Asset, DbClient } from "@photon/db";
import { assets } from "@photon/db";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsStore = new Map<string, Asset>();
const enqueueWebhookEvent = vi.fn().mockResolvedValue(undefined);

function baseAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_1",
    orgId: "org_1",
    publicId: "products/shoe",
    storageKey: "orgs/org_1/orig/asset_1",
    status: "pending",
    mimeType: null,
    bytes: null,
    width: null,
    height: null,
    checksum: null,
    metadata: {},
    tags: [],
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const fakeDb: DbClient = {
  db: {
    query: {
      assets: {
        findFirst: async ({ where }: { where: (a: Asset, ops: unknown) => boolean }) => {
          const rows = [...assetsStore.values()];
          const ops = {
            eq: (field: unknown, val: unknown) => (row: Asset) =>
              (row as never)[field as string] === val,
            and:
              (...preds: ((row: Asset) => boolean)[]) =>
              (row: Asset) =>
                preds.every((p) => p(row)),
            isNull: (field: unknown) => (row: Asset) => (row as never)[field as string] == null,
          };
          const fieldProxy = new Proxy({}, { get: (_t, prop) => prop }) as Asset;
          const predicate = where(fieldProxy, ops) as unknown as (row: Asset) => boolean;
          return rows.find(predicate);
        },
      },
    },
    update: (table: unknown) => {
      if (table !== assets) throw new Error("unsupported table");
      return {
        set: (patch: Partial<Asset>) => ({
          where: async () => {
            const [row] = [...assetsStore.values()];
            if (row) assetsStore.set(row.id, { ...row, ...patch });
          },
        }),
      };
    },
  },
  close: async () => {},
} as unknown as DbClient;

let storageObject: { buf: Buffer; contentType?: string } | undefined;

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));
vi.mock("../storage", () => ({
  getStorageClient: () => ({
    get: async () => {
      if (!storageObject) throw new Error("no object seeded");
      return { stream: Readable.from(storageObject.buf), contentType: storageObject.contentType };
    },
  }),
}));
vi.mock("../webhooks", () => ({ enqueueWebhookEvent }));

const { processAsset } = await import("../process-asset");

beforeEach(() => {
  assetsStore.clear();
  enqueueWebhookEvent.mockClear();
  storageObject = undefined;
});

describe("processAsset", () => {
  it("flips a valid image to ready and fires asset.ready", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const png = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    storageObject = { buf: png, contentType: "image/png" };

    await processAsset({ data: { assetId: asset.id } });

    const updated = assetsStore.get(asset.id);
    expect(updated?.status).toBe("ready");
    expect(updated?.width).toBe(4);
    expect(updated?.height).toBe(2);
    expect(updated?.checksum).toBeTruthy();
    expect(enqueueWebhookEvent).toHaveBeenCalledWith(
      fakeDb,
      "org_1",
      "asset.ready",
      expect.objectContaining({ assetId: asset.id, status: "ready" }),
    );
  });

  it("flips an undecodable file to failed and fires asset.failed", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    storageObject = { buf: Buffer.from("not an image"), contentType: "text/plain" };

    await processAsset({ data: { assetId: asset.id } });

    const updated = assetsStore.get(asset.id);
    expect(updated?.status).toBe("failed");
    expect(enqueueWebhookEvent).toHaveBeenCalledWith(
      fakeDb,
      "org_1",
      "asset.failed",
      expect.objectContaining({ assetId: asset.id, status: "failed" }),
    );
  });

  it("is a no-op when the asset does not exist", async () => {
    await processAsset({ data: { assetId: "missing" } });
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });
});
