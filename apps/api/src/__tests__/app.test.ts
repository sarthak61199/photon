import { createHash } from "node:crypto";
import type { ApiKey, Org } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { resetRateLimiter } from "../auth";
import { fakeDbClient } from "./fake-db";
import { fakeQueue } from "./fake-queue";
import { fakeStorage } from "./fake-storage";

vi.mock("../db", () => ({ getDbClient: () => fakeDbClient }));
vi.mock("../storage", () => ({ getStorageClient: () => fakeStorage }));
vi.mock("../queue", async () => {
  const { enqueueFetchUrl, enqueueProcessAsset, enqueuePurgeAsset } = await import("./fake-queue");
  return { enqueueFetchUrl, enqueueProcessAsset, enqueuePurgeAsset };
});

interface ErrorBody {
  error: string;
  message?: string;
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function seedOrgWithKey(scopes: string[] = ["read", "write"]): {
  org: Org;
  apiKey: ApiKey;
  rawKey: string;
} {
  const org = fakeDbClient.fake.seedOrg({});
  const rawKey = `test_${org.id}_${scopes.join("-")}`;
  const apiKey = fakeDbClient.fake.seedApiKey({
    orgId: org.id,
    keyHash: hashKey(rawKey),
    scopes,
  });
  return { org, apiKey, rawKey };
}

function authHeaders(rawKey: string): Record<string, string> {
  return { authorization: `Bearer ${rawKey}` };
}

beforeEach(() => {
  fakeDbClient.fake.clear();
  fakeStorage.clear();
  fakeQueue.clear();
  resetRateLimiter();
});

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("auth", () => {
  it("returns 401 when no api key is provided", async () => {
    const res = await app.request("/v1/assets");
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error).toBe("missing_api_key");
  });

  it("returns 401 for an invalid api key", async () => {
    const res = await app.request("/v1/assets", { headers: authHeaders("garbage") });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error).toBe("invalid_api_key");
  });

  it("passes through for a valid api key", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/assets", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(200);
  });

  it("returns 403 when a read-only key hits a write route", async () => {
    const { rawKey } = seedOrgWithKey(["read"]);
    const res = await app.request("/v1/uploads", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "products/shoe", contentType: "image/jpeg" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error).toBe("insufficient_scope");
  });

  it("returns 429 once an org exhausts its request budget", async () => {
    const { rawKey } = seedOrgWithKey();

    for (let i = 0; i < 100; i++) {
      await app.request("/v1/assets", { headers: authHeaders(rawKey) });
    }

    const res = await app.request("/v1/assets", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorBody).error).toBe("rate_limited");
  });

  it("does not rate-limit a different org", async () => {
    const exhausted = seedOrgWithKey();
    const other = seedOrgWithKey();

    for (let i = 0; i < 100; i++) {
      await app.request("/v1/assets", { headers: authHeaders(exhausted.rawKey) });
    }

    const res = await app.request("/v1/assets", { headers: authHeaders(other.rawKey) });
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/uploads", () => {
  it("creates a pending asset and returns a presigned post", async () => {
    const { org, rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/uploads", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "products/shoe", contentType: "image/jpeg" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string; storageKey: string; upload: unknown };
    expect(body.storageKey).toBe(`orgs/${org.id}/orig/${body.assetId}`);
    expect(body.upload).toEqual({
      url: "https://fake-upload.example/",
      fields: { key: body.storageKey, "Content-Type": "image/jpeg" },
    });

    expect(fakeStorage.presignPostCalls).toEqual([
      {
        key: body.storageKey,
        contentType: "image/jpeg",
        maxBytes: 50 * 1024 * 1024,
        expiresInSeconds: 900,
      },
    ]);

    const asset = fakeDbClient.fake.getAsset(body.assetId);
    expect(asset?.status).toBe("pending");
    expect(asset?.publicId).toBe("products/shoe");
  });

  it("returns 409 for a duplicate publicId in the same org", async () => {
    const { rawKey } = seedOrgWithKey();
    const create = () =>
      app.request("/v1/uploads", {
        method: "POST",
        headers: { ...authHeaders(rawKey), "content-type": "application/json" },
        body: JSON.stringify({ publicId: "products/shoe", contentType: "image/jpeg" }),
      });

    expect((await create()).status).toBe(201);
    const second = await create();
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).error).toBe("duplicate_public_id");
  });

  it("allows the same publicId across different orgs", async () => {
    const first = seedOrgWithKey();
    const second = seedOrgWithKey();
    const create = (rawKey: string) =>
      app.request("/v1/uploads", {
        method: "POST",
        headers: { ...authHeaders(rawKey), "content-type": "application/json" },
        body: JSON.stringify({ publicId: "products/shoe", contentType: "image/jpeg" }),
      });

    expect((await create(first.rawKey)).status).toBe(201);
    expect((await create(second.rawKey)).status).toBe(201);
  });
});

describe("POST /v1/uploads/complete", () => {
  it("enqueues a process-asset job for an existing asset", async () => {
    const { org, rawKey } = seedOrgWithKey();
    const asset = fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "products/shoe" });

    const res = await app.request("/v1/uploads/complete", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ assetId: asset.id }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assetId: asset.id, status: "pending" });
    expect(fakeQueue.sent).toEqual([{ name: "process-asset", data: { assetId: asset.id } }]);
  });

  it("returns 404 for an unknown asset", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/uploads/complete", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ assetId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an asset belonging to another org", async () => {
    const owner = seedOrgWithKey();
    const other = seedOrgWithKey();
    const asset = fakeDbClient.fake.seedAsset({ orgId: owner.org.id, publicId: "products/shoe" });

    const res = await app.request("/v1/uploads/complete", {
      method: "POST",
      headers: { ...authHeaders(other.rawKey), "content-type": "application/json" },
      body: JSON.stringify({ assetId: asset.id }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/assets/fetch", () => {
  it("creates a pending asset and enqueues a fetch-url job", async () => {
    const { org, rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/assets/fetch", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "products/shoe", url: "http://93.184.216.34/shoe.jpg" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string; storageKey: string; status: string };
    expect(body.status).toBe("pending");
    expect(body.storageKey).toBe(`orgs/${org.id}/orig/${body.assetId}`);

    const asset = fakeDbClient.fake.getAsset(body.assetId);
    expect(asset?.status).toBe("pending");
    expect(fakeQueue.sent).toEqual([
      { name: "fetch-url", data: { assetId: body.assetId, url: "http://93.184.216.34/shoe.jpg" } },
    ]);
  });

  it("rejects a URL that resolves to a private address, without creating an asset", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/assets/fetch", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "products/shoe", url: "http://127.0.0.1/admin" }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("unsafe_url");
    expect(fakeQueue.sent).toEqual([]);
  });

  it("returns 409 for a duplicate publicId", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "products/shoe" });

    const res = await app.request("/v1/assets/fetch", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "products/shoe", url: "http://93.184.216.34/shoe.jpg" }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error).toBe("duplicate_public_id");
  });
});

describe("GET /v1/assets", () => {
  it("paginates results across pages, newest first", async () => {
    const { org, rawKey } = seedOrgWithKey();
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      fakeDbClient.fake.seedAsset({
        orgId: org.id,
        publicId: `products/item-${i}`,
        createdAt: new Date(base + i * 1000),
      });
    }

    const firstRes = await app.request("/v1/assets?limit=3", { headers: authHeaders(rawKey) });
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      assets: { publicId: string }[];
      nextCursor: string | null;
    };
    expect(firstBody.assets.map((a) => a.publicId)).toEqual([
      "products/item-4",
      "products/item-3",
      "products/item-2",
    ]);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondRes = await app.request(`/v1/assets?limit=3&cursor=${firstBody.nextCursor}`, {
      headers: authHeaders(rawKey),
    });
    const secondBody = (await secondRes.json()) as {
      assets: { publicId: string }[];
      nextCursor: string | null;
    };
    expect(secondBody.assets.map((a) => a.publicId)).toEqual([
      "products/item-1",
      "products/item-0",
    ]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("excludes soft-deleted assets", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "a", deletedAt: new Date() });
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "b" });

    const res = await app.request("/v1/assets", { headers: authHeaders(rawKey) });
    const body = (await res.json()) as { assets: { publicId: string }[] };
    expect(body.assets.map((a) => a.publicId)).toEqual(["b"]);
  });

  it("filters by tag", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "a", tags: ["hero"] });
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "b", tags: ["thumb"] });

    const res = await app.request("/v1/assets?tag=hero", { headers: authHeaders(rawKey) });
    const body = (await res.json()) as { assets: { publicId: string }[] };
    expect(body.assets.map((a) => a.publicId)).toEqual(["a"]);
  });

  it("never leaks assets across orgs", async () => {
    const mine = seedOrgWithKey();
    const other = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: other.org.id, publicId: "not-mine" });

    const res = await app.request("/v1/assets", { headers: authHeaders(mine.rawKey) });
    const body = (await res.json()) as { assets: unknown[] };
    expect(body.assets).toEqual([]);
  });

  it("returns 400 for a malformed cursor", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/assets?cursor=not-valid-base64!!", {
      headers: authHeaders(rawKey),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("bad_cursor");
  });
});

describe("GET /v1/assets/:publicId", () => {
  it("returns the asset when found", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "products/shoe" });

    const res = await app.request("/v1/assets/products%2Fshoe", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(200);
  });

  it("returns 404 when not found", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/assets/does-not-exist", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a soft-deleted asset", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "gone", deletedAt: new Date() });

    const res = await app.request("/v1/assets/gone", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an asset in another org", async () => {
    const owner = seedOrgWithKey();
    const other = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: owner.org.id, publicId: "theirs" });

    const res = await app.request("/v1/assets/theirs", { headers: authHeaders(other.rawKey) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/assets/:publicId", () => {
  it("updates tags only", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe", tags: ["old"] });

    const res = await app.request("/v1/assets/shoe", {
      method: "PATCH",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ tags: ["new"] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: string[]; metadata: unknown };
    expect(body.tags).toEqual(["new"]);
  });

  it("updates metadata only", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe" });

    const res = await app.request("/v1/assets/shoe", {
      method: "PATCH",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ metadata: { color: "red" } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { metadata: Record<string, unknown> };
    expect(body.metadata).toEqual({ color: "red" });
  });

  it("returns 400 for an empty body", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe" });

    const res = await app.request("/v1/assets/shoe", {
      method: "PATCH",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("bad_request");
  });
});

describe("DELETE /v1/assets/:publicId", () => {
  it("soft-deletes the asset and enqueues a purge job", async () => {
    const { org, rawKey } = seedOrgWithKey();
    const asset = fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe" });

    const res = await app.request("/v1/assets/shoe", {
      method: "DELETE",
      headers: authHeaders(rawKey),
    });
    expect(res.status).toBe(204);

    const again = await app.request("/v1/assets/shoe", { headers: authHeaders(rawKey) });
    expect(again.status).toBe(404);
    expect(fakeQueue.sent).toEqual([{ name: "purge-asset", data: { assetId: asset.id } }]);
  });

  it("returns 404 when deleting an already-deleted asset", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe" });

    await app.request("/v1/assets/shoe", { method: "DELETE", headers: authHeaders(rawKey) });
    const second = await app.request("/v1/assets/shoe", {
      method: "DELETE",
      headers: authHeaders(rawKey),
    });
    expect(second.status).toBe(404);
  });
});

describe("POST /v1/presets", () => {
  it("creates a preset with defaulted transform params", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/presets", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ name: "thumbnail", params: { w: 300, h: 300, c: "fill" } }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; params: Record<string, unknown> };
    expect(body.name).toBe("thumbnail");
    expect(body.params).toMatchObject({ w: 300, h: 300, c: "fill", f: "auto", dpr: 1 });
  });

  it("returns 409 for a duplicate preset name in the same org", async () => {
    const { rawKey } = seedOrgWithKey();
    const create = () =>
      app.request("/v1/presets", {
        method: "POST",
        headers: { ...authHeaders(rawKey), "content-type": "application/json" },
        body: JSON.stringify({ name: "thumbnail", params: { w: 300 } }),
      });

    expect((await create()).status).toBe(201);
    const second = await create();
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).error).toBe("duplicate_preset_name");
  });

  it("returns 400 for out-of-range transform params", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/presets", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ name: "huge", params: { w: 99999 } }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /v1/purge", () => {
  it("enqueues a purge job for an existing asset", async () => {
    const { org, rawKey } = seedOrgWithKey();
    const asset = fakeDbClient.fake.seedAsset({ orgId: org.id, publicId: "shoe" });

    const res = await app.request("/v1/purge", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "shoe" }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ assetId: asset.id, status: "purge_queued" });
    expect(fakeQueue.sent).toEqual([{ name: "purge-asset", data: { assetId: asset.id } }]);
  });

  it("still purges an already soft-deleted asset", async () => {
    const { org, rawKey } = seedOrgWithKey();
    const asset = fakeDbClient.fake.seedAsset({
      orgId: org.id,
      publicId: "shoe",
      deletedAt: new Date(),
    });

    const res = await app.request("/v1/purge", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "shoe" }),
    });

    expect(res.status).toBe(202);
    expect(fakeQueue.sent).toEqual([{ name: "purge-asset", data: { assetId: asset.id } }]);
  });

  it("returns 404 for an unknown asset", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/purge", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ publicId: "does-not-exist" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /v1/webhooks", () => {
  it("creates a webhook with a generated secret shown once", async () => {
    const { org, rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/hook" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      orgId: string;
      url: string;
      secret: string;
      events: string[];
    };
    expect(body.orgId).toBe(org.id);
    expect(body.url).toBe("https://example.com/hook");
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.events).toEqual(["asset.ready", "asset.failed"]);

    const stored = fakeDbClient.fake.getWebhooks();
    expect(stored).toHaveLength(1);
  });

  it("accepts a custom events list", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/hook", events: ["asset.failed"] }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { events: string[] };
    expect(body.events).toEqual(["asset.failed"]);
  });

  it("returns 400 for an empty events array", async () => {
    const { rawKey } = seedOrgWithKey();

    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: { ...authHeaders(rawKey), "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/hook", events: [] }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /v1/usage", () => {
  it("defaults to the last 30 days ending today when no params given", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedUsageDaily({ orgId: org.id, day: "2020-01-01", requests: 999 });

    const res = await app.request("/v1/usage", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: string; to: string; usage: unknown[] };
    // 2020-01-01 is far outside any "last 30 days" window, so it must not appear.
    expect(body.usage).toEqual([]);
    expect(new Date(body.to).getTime()).toBeGreaterThanOrEqual(new Date(body.from).getTime());
  });

  it("returns rows within an explicit range, ordered, with totals", async () => {
    const { org, rawKey } = seedOrgWithKey();
    fakeDbClient.fake.seedUsageDaily({
      orgId: org.id,
      day: "2026-08-02",
      requests: 5,
      transforms: 2,
      bandwidth: 1000,
      storage: 10,
    });
    fakeDbClient.fake.seedUsageDaily({
      orgId: org.id,
      day: "2026-08-01",
      requests: 3,
      transforms: 1,
      bandwidth: 500,
      storage: 5,
    });

    const res = await app.request("/v1/usage?from=2026-08-01&to=2026-08-02", {
      headers: authHeaders(rawKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { day: string }[];
      totals: { requests: number; transforms: number; bandwidth: number; storage: number };
    };
    expect(body.usage.map((r) => r.day)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(body.totals).toEqual({ requests: 8, transforms: 3, bandwidth: 1500, storage: 15 });
  });

  it("returns 400 when from is after to", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/usage?from=2026-08-02&to=2026-08-01", {
      headers: authHeaders(rawKey),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("invalid_usage_range");
  });

  it("returns 400 for a malformed date", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/usage?from=not-a-date", { headers: authHeaders(rawKey) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("invalid_usage_range");
  });

  it("returns 400 when the range exceeds the cap", async () => {
    const { rawKey } = seedOrgWithKey();
    const res = await app.request("/v1/usage?from=2020-01-01&to=2026-08-02", {
      headers: authHeaders(rawKey),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toBe("invalid_usage_range");
  });

  it("never leaks another org's usage rows", async () => {
    const mine = seedOrgWithKey();
    const other = seedOrgWithKey();
    fakeDbClient.fake.seedUsageDaily({ orgId: other.org.id, day: "2026-08-02", requests: 42 });

    const res = await app.request("/v1/usage?from=2026-08-01&to=2026-08-02", {
      headers: authHeaders(mine.rawKey),
    });
    const body = (await res.json()) as { usage: unknown[] };
    expect(body.usage).toEqual([]);
  });
});
