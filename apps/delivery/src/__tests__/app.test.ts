import { parseTransforms, sign } from "@img/core";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { derivativeKey } from "../keys";
import { fakeStorage } from "./fake-storage";
import { createFixtureJpeg } from "./fixtures";

vi.mock("../storage", async () => {
  const { fakeStorage } = await import("./fake-storage");
  return { getStorageClient: () => fakeStorage };
});

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_KEY = "orgs/acme/orig/products/shoe.jpg";

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

  beforeEach(async () => {
    fixture = await createFixtureJpeg({ width: 40, height: 20 });
    fakeStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("transforms and returns the image on a cache miss", async () => {
    fakeStorage.seed(ORIGINAL_KEY, fixture, "image/jpeg");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("vary")).toBe("accept");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(10);
  });

  it("persists the derivative after a cache miss (write-behind)", async () => {
    fakeStorage.seed(ORIGINAL_KEY, fixture, "image/jpeg");
    const transform = parseTransforms("w_10,f_jpg");
    const derivKey = derivativeKey("acme", "products/shoe.jpg", transform, "jpg");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(fakeStorage.has(derivKey)).toBe(true);
    });
  });

  it("serves the cached derivative without re-fetching the original", async () => {
    const transform = parseTransforms("w_10,f_jpg");
    const derivKey = derivativeKey("acme", "products/shoe.jpg", transform, "jpg");
    const cached = await sharp(fixture).resize({ width: 10 }).jpeg().toBuffer();
    fakeStorage.seed(derivKey, cached, "image/jpeg");
    // deliberately do NOT seed the original — a hit must never touch it

    const getSpy = vi.spyOn(fakeStorage, "get");

    const res = await app.request("/acme/w_10,f_jpg/products/shoe.jpg");

    expect(res.status).toBe(200);
    expect(getSpy).toHaveBeenCalledWith(derivKey);
    expect(getSpy).not.toHaveBeenCalledWith(ORIGINAL_KEY);
  });

  it("returns 404 when the original does not exist", async () => {
    const res = await app.request("/acme/w_10/products/does-not-exist.jpg");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe("not_found");
  });

  it("negotiates avif via the Accept header for f_auto", async () => {
    fakeStorage.seed(ORIGINAL_KEY, fixture, "image/jpeg");

    const res = await app.request("/acme/w_10/products/shoe.jpg", {
      headers: { accept: "image/avif,image/webp,*/*" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/avif");
  });

  it("falls back to jpeg when the Accept header has no known image formats", async () => {
    fakeStorage.seed(ORIGINAL_KEY, fixture, "image/jpeg");

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

  describe("when signed URLs are required", () => {
    beforeEach(() => {
      process.env.DELIVERY_REQUIRE_SIGNED_URLS = "true";
      process.env.DELIVERY_SIGNING_KEY = "test-signing-key";
    });

    it("returns 401 when the signature is missing", async () => {
      const res = await app.request("/acme/w_800/products/shoe.jpg");
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toBe("unauthorized");
    });

    it("returns 401 when the signature is invalid", async () => {
      const res = await app.request("/acme/s_wrongsignature,w_800/products/shoe.jpg");
      expect(res.status).toBe(401);
    });

    it("returns 200 for a validly signed request", async () => {
      fakeStorage.seed(ORIGINAL_KEY, fixture, "image/jpeg");
      const key = Buffer.from("test-signing-key");
      const rest = "w_10,f_jpg/products/shoe.jpg";
      const sig = sign(rest, key);

      const res = await app.request(`/acme/s_${sig},${rest}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
    });
  });
});
