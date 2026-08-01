import type { Asset, DbClient } from "@photon/db";
import { assets } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsStore = new Map<string, Asset>();
const enqueueWebhookEvent = vi.fn().mockResolvedValue(undefined);
const processAsset = vi.fn().mockResolvedValue(undefined);
const storagePut = vi.fn().mockResolvedValue(undefined);

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

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));
vi.mock("../storage", () => ({ getStorageClient: () => ({ put: storagePut }) }));
vi.mock("../process-asset", () => ({
  processAsset: (...args: unknown[]) => processAsset(...args),
}));
vi.mock("../webhooks", () => ({
  enqueueWebhookEvent: (...args: unknown[]) => enqueueWebhookEvent(...args),
}));

const { fetchUrl } = await import("../fetch-url");

beforeEach(() => {
  assetsStore.clear();
  enqueueWebhookEvent.mockClear();
  processAsset.mockClear();
  storagePut.mockClear();
  vi.restoreAllMocks();
});

describe("fetchUrl", () => {
  it("downloads, stores the bytes, and hands off to processAsset", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const body = Buffer.from("fake-image-bytes");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    await fetchUrl({ data: { assetId: asset.id, url: "http://93.184.216.34/shoe.jpg" } });

    expect(storagePut).toHaveBeenCalledWith(asset.storageKey, expect.any(Buffer));
    const [, putBody] = storagePut.mock.calls[0] as [string, Buffer];
    expect(putBody.toString()).toBe("fake-image-bytes");
    expect(processAsset).toHaveBeenCalledWith({ data: { assetId: asset.id } });
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("follows a redirect to a public address", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://93.184.216.35/final.jpg" } }),
    );
    fetchSpy.mockResolvedValueOnce(new Response(Buffer.from("final-bytes"), { status: 200 }));

    await fetchUrl({ data: { assetId: asset.id, url: "http://93.184.216.34/shoe.jpg" } });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(storagePut).toHaveBeenCalledWith(asset.storageKey, expect.any(Buffer));
    expect(processAsset).toHaveBeenCalledWith({ data: { assetId: asset.id } });
  });

  it("marks the asset failed and fires asset.failed when the fetch returns a non-2xx status", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    await fetchUrl({ data: { assetId: asset.id, url: "http://93.184.216.34/missing.jpg" } });

    expect(assetsStore.get(asset.id)?.status).toBe("failed");
    expect(processAsset).not.toHaveBeenCalled();
    expect(enqueueWebhookEvent).toHaveBeenCalledWith(
      fakeDb,
      asset.orgId,
      "asset.failed",
      expect.objectContaining({ assetId: asset.id, status: "failed" }),
    );
  });

  it("refuses a URL that resolves to a private address without calling fetch", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await fetchUrl({ data: { assetId: asset.id, url: "http://127.0.0.1/admin" } });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assetsStore.get(asset.id)?.status).toBe("failed");
    expect(processAsset).not.toHaveBeenCalled();
  });

  it("gives up after too many redirects", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://93.184.216.35/loop.jpg" } }),
    );

    await fetchUrl({ data: { assetId: asset.id, url: "http://93.184.216.34/shoe.jpg" } });

    expect(assetsStore.get(asset.id)?.status).toBe("failed");
    expect(processAsset).not.toHaveBeenCalled();
  });

  it("is a no-op when the asset does not exist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await fetchUrl({ data: { assetId: "missing", url: "http://93.184.216.34/x.jpg" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(processAsset).not.toHaveBeenCalled();
  });
});
