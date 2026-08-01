import { parseTransforms, sign } from "@photon/core";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, resetRateLimiter } from "../app";
import { derivativeKey } from "../keys";
import { resetAssetCache } from "../resolve-asset";
import { resetPresetCache } from "../resolve-preset";
import { createFakeDbClient } from "./fake-db";
import { fakeStorage } from "./fake-storage";
import { createFixtureJpeg } from "./fixtures";

vi.mock("../storage", async () => {
  const { fakeStorage } = await import("./fake-storage");
  return { getStorageClient: () => fakeStorage };
});

const fakeDb = createFakeDbClient();
vi.mock("../db", () => ({
  getDbClient: () => fakeDb,
}));

const recordRequestUsage = vi.fn();
vi.mock("../usage", () => ({
  recordRequestUsage: (...args: unknown[]) => recordRequestUsage(...args),
}));

interface ErrorBody {
  error: string;
  message?: string;
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /:org/:transforms/:path", () => {
  let fixture: Buffer;

  function seedReadyAsset(opts?: { requiresSignedUrls?: boolean; urlSignKey?: Buffer }) {
    const org = fakeDb.fake.seedOrg({ slug: "acme", ...opts });
    const asset = fakeDb.fake.seedAsset({
      orgId: org.id,
      publicId: "products/shoe.jpg",
      status: "ready",
    });
    return { org, asset };
  }

  beforeEach(async () => {
    fixture = await createFixtureJpeg({ width: 40, height: 20 });
    fakeStorage.clear();
    fakeDb.fake.clear();
    resetAssetCache();
    resetPresetCache();
    resetRateLimiter();
    recordRequestUsage.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transforms and returns the image on a cache miss", async () => {
    const { asset } = seedReadyAsset();
    fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("vary")).toBe("accept");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(10);

    expect(recordRequestUsage).toHaveBeenCalledWith(asset.orgId, {
      transformed: true,
      bytes: buf.length,
    });
  });

  it("persists the derivative after a cache miss (write-behind)", async () => {
    const { org, asset } = seedReadyAsset();
    fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");
    const transform = parseTransforms("w_10,f_jpg");
    const derivKey = derivativeKey(org.id, asset.id, transform, "jpg");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(fakeStorage.has(derivKey)).toBe(true);
    });
    await vi.waitFor(() => {
      expect(fakeDb.fake.listDerivatives()).toContainEqual(
        expect.objectContaining({ assetId: asset.id, storageKey: derivKey }),
      );
    });
  });

  it("serves the cached derivative without re-fetching the original", async () => {
    const { org, asset } = seedReadyAsset();
    const transform = parseTransforms("w_10,f_jpg");
    const derivKey = derivativeKey(org.id, asset.id, transform, "jpg");
    const cached = await sharp(fixture).resize({ width: 10 }).jpeg().toBuffer();
    fakeStorage.seed(derivKey, cached, "image/jpeg");
    // deliberately do NOT seed the original — a hit must never touch it

    const getSpy = vi.spyOn(fakeStorage, "get");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");

    expect(res.status).toBe(200);
    expect(getSpy).toHaveBeenCalledWith(derivKey);
    expect(getSpy).not.toHaveBeenCalledWith(asset.storageKey);
    expect(recordRequestUsage).toHaveBeenCalledWith(asset.orgId, {
      transformed: false,
      bytes: cached.length,
    });
  });

  it("returns 404 when the org does not exist", async () => {
    const res = await app.request("/nonexistent/w_10/products/shoe.jpg");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when the asset does not exist", async () => {
    fakeDb.fake.seedOrg({ slug: "acme" });

    const res = await app.request("/acme/w_10/products/does-not-exist.jpg");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when the asset is not ready", async () => {
    const org = fakeDb.fake.seedOrg({ slug: "acme" });
    fakeDb.fake.seedAsset({ orgId: org.id, publicId: "products/shoe.jpg", status: "pending" });

    const res = await app.request("/acme/w_10/products/shoe.jpg");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the original is missing from storage", async () => {
    seedReadyAsset();

    const res = await app.request("/acme/w_10/products/shoe.jpg");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("not_found");
  });

  it("only queries the database once per asset within the cache TTL", async () => {
    const { asset } = seedReadyAsset();
    fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");
    const findFirstSpy = vi.spyOn(fakeDb.db.query.assets, "findFirst");

    await app.request("/acme/w_10/products/shoe.jpg");
    await app.request("/acme/w_20/products/shoe.jpg");

    expect(findFirstSpy).toHaveBeenCalledTimes(1);
  });

  it("negotiates avif via the Accept header for f_auto", async () => {
    const { asset } = seedReadyAsset();
    fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");

    const res = await app.request("/acme/w_10/products/shoe.jpg", {
      headers: { accept: "image/avif,image/webp,*/*" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/avif");
  });

  it("falls back to jpeg when the Accept header has no known image formats", async () => {
    const { asset } = seedReadyAsset();
    fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");

    const res = await app.request("/acme/w_10/products/shoe.jpg", {
      headers: { accept: "text/html" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("rejects a path-traversal attempt in the public id", async () => {
    // Hono's router collapses literal ".." segments between real slashes before
    // routing even happens, so the only way a ".." segment reaches the handler
    // intact is via an encoded slash (%2f) hiding a segment boundary from the router.
    const res = await app.request("/acme/w_10/foo%2f..%2fbar.jpg");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("bad_path");
  });

  it("rejects a path-traversal attempt in the org segment", async () => {
    const res = await app.request("/acme%2f..%2f/w_10/foo.jpg");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("bad_path");
  });

  it("returns 400 for a malformed transform segment", async () => {
    const res = await app.request("/acme/w800/products/shoe.jpg");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("bad_transform");
  });

  it("returns 400 for an out-of-range transform value", async () => {
    const res = await app.request("/acme/w_99999/products/shoe.jpg");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("bad_transform");
  });

  describe("t_name preset segment", () => {
    it("renders using the preset's stored params", async () => {
      const { org, asset } = seedReadyAsset();
      fakeDb.fake.seedPreset({ orgId: org.id, name: "thumb", params: { w: 20, h: 10, c: "fill" } });
      fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");

      const res = await app.request("/acme/t_thumb/products/shoe.jpg");

      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(20);
      expect(meta.height).toBe(10);
    });

    it("returns 404 for an unknown preset name", async () => {
      seedReadyAsset();

      const res = await app.request("/acme/t_does-not-exist/products/shoe.jpg");
      expect(res.status).toBe(404);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toBe("not_found");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 once an org exhausts its request budget", async () => {
      // Rate limiting runs before any org/asset lookup, so the org need not exist.
      for (let i = 0; i < 100; i++) {
        await app.request("/acme/w_1/products/does-not-exist.jpg");
      }

      const res = await app.request("/acme/w_1/products/does-not-exist.jpg");
      expect(res.status).toBe(429);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toBe("rate_limited");
    });

    it("does not rate-limit a different org", async () => {
      for (let i = 0; i < 101; i++) {
        await app.request("/acme/w_1/products/does-not-exist.jpg");
      }

      const res = await app.request("/other-org/w_1/products/does-not-exist.jpg");
      expect(res.status).not.toBe(429);
    });
  });

  describe("when the org requires signed URLs", () => {
    const key = Buffer.from("test-signing-key");

    it("returns 401 when the signature is missing", async () => {
      seedReadyAsset({ requiresSignedUrls: true, urlSignKey: key });

      const res = await app.request("/acme/w_800/products/shoe.jpg");
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toBe("unauthorized");
    });

    it("returns 401 when the signature is invalid", async () => {
      seedReadyAsset({ requiresSignedUrls: true, urlSignKey: key });

      const res = await app.request("/acme/s_wrongsignature,w_800/products/shoe.jpg");
      expect(res.status).toBe(401);
    });

    it("returns 200 for a validly signed request", async () => {
      const { asset } = seedReadyAsset({ requiresSignedUrls: true, urlSignKey: key });
      fakeStorage.seed(asset.storageKey, fixture, "image/jpeg");
      const rest = "w_10,f_jpg/products/shoe.jpg";
      const sig = sign(rest, key);

      const res = await app.request(`/acme/s_${sig},${rest}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
    });
  });
});
