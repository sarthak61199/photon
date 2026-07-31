import type { Transform } from "@img/core";
import { parseTransforms } from "@img/core";
import { describe, expect, it } from "vitest";
import {
  assertSafeOrg,
  assertSafePublicId,
  derivativeKey,
  originalKey,
  PathTraversalError,
} from "../keys";

describe("assertSafeOrg", () => {
  it("accepts a plain slug", () => {
    expect(() => assertSafeOrg("acme")).not.toThrow();
  });

  it("rejects '..'", () => {
    expect(() => assertSafeOrg("..")).toThrow(PathTraversalError);
  });

  it("rejects '.'", () => {
    expect(() => assertSafeOrg(".")).toThrow(PathTraversalError);
  });

  it("rejects an empty string", () => {
    expect(() => assertSafeOrg("")).toThrow(PathTraversalError);
  });

  it("rejects a traversal segment embedded via a slash", () => {
    expect(() => assertSafeOrg("foo/..")).toThrow(PathTraversalError);
  });
});

describe("assertSafePublicId", () => {
  it("accepts a nested public id", () => {
    expect(() => assertSafePublicId("products/shoe.jpg")).not.toThrow();
  });

  it("rejects a traversal segment anywhere in the path", () => {
    expect(() => assertSafePublicId("products/../etc/passwd")).toThrow(PathTraversalError);
  });

  it("rejects a leading traversal segment", () => {
    expect(() => assertSafePublicId("../etc/passwd")).toThrow(PathTraversalError);
  });

  it("rejects an empty segment (double slash)", () => {
    expect(() => assertSafePublicId("products//shoe.jpg")).toThrow(PathTraversalError);
  });
});

describe("originalKey", () => {
  it("builds the orig storage key", () => {
    expect(originalKey("acme", "products/shoe.jpg")).toBe("orgs/acme/orig/products/shoe.jpg");
  });
});

describe("derivativeKey", () => {
  it("builds the deriv storage key using the canonical transform key", () => {
    const t: Transform = parseTransforms("w_800,q_80");
    const key = derivativeKey("acme", "products/shoe.jpg", t, "webp");
    expect(key).toBe(
      "orgs/acme/deriv/products/shoe.jpg/c_fit,dpr_1,f_auto,g_center,q_80,w_800.webp",
    );
  });
});
