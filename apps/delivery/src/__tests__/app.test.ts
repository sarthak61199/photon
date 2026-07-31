import { sign } from "@img/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";

const ORIGINAL_ENV = { ...process.env };

interface ErrorBody {
  error: string;
  message?: string;
}

interface EchoBody {
  org: string;
  publicId: string;
  transform: { w?: number; h?: number; q?: number; f?: string; c?: string };
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /:org/:transforms/:path", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("echoes the parsed transform for a valid unsigned request", async () => {
    const res = await app.request("/acme/w_800,q_80,f_auto/products/shoe.jpg");
    expect(res.status).toBe(200);
    const body = (await res.json()) as EchoBody;
    expect(body.org).toBe("acme");
    expect(body.publicId).toBe("products/shoe.jpg");
    expect(body.transform.w).toBe(800);
    expect(body.transform.q).toBe(80);
    expect(body.transform.f).toBe("auto");
    expect(body.transform.c).toBe("fit");
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
      const key = Buffer.from("test-signing-key");
      const rest = "w_800/products/shoe.jpg";
      const sig = sign(rest, key);

      const res = await app.request(`/acme/s_${sig},${rest}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as EchoBody;
      expect(body.transform.w).toBe(800);
    });
  });
});
