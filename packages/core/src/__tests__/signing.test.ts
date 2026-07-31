import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../errors";
import { sign, verifySignature } from "../signing";

const key = Buffer.from("test-signing-key");
const otherKey = Buffer.from("a-different-key");

describe("sign", () => {
  it("is deterministic", () => {
    expect(sign("w_800/products/shoe.jpg", key)).toBe(sign("w_800/products/shoe.jpg", key));
  });

  it("produces a 16-character base64url string", () => {
    const sig = sign("w_800/products/shoe.jpg", key);
    expect(sig).toHaveLength(16);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("verifySignature", () => {
  const rest = "w_800/products/shoe.jpg";
  const sig = sign(rest, key);

  it("does not throw for a valid signature (comma separator)", () => {
    expect(() => verifySignature(`/acme/s_${sig},${rest}`, key)).not.toThrow();
  });

  it("does not throw for a valid signature (slash separator)", () => {
    expect(() => verifySignature(`/acme/s_${sig}/${rest}`, key)).not.toThrow();
  });

  it("throws UnauthorizedError for a tampered signature", () => {
    const tampered = `${sig.slice(0, -1)}${sig.at(-1) === "a" ? "b" : "a"}`;
    expect(() => verifySignature(`/acme/s_${tampered},${rest}`, key)).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError for a tampered payload", () => {
    expect(() => verifySignature(`/acme/s_${sig},w_400/products/shoe.jpg`, key)).toThrow(
      UnauthorizedError,
    );
  });

  it("throws UnauthorizedError when the path has no s_ segment", () => {
    expect(() => verifySignature(`/acme/${rest}`, key)).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError when the org-slug segment is missing", () => {
    expect(() => verifySignature(`/s_${sig},${rest}`, key)).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError for a mismatched-length signature", () => {
    expect(() => verifySignature(`/acme/s_short,${rest}`, key)).toThrow(UnauthorizedError);
  });

  it("throws UnauthorizedError when verified with the wrong key", () => {
    expect(() => verifySignature(`/acme/s_${sig},${rest}`, otherKey)).toThrow(UnauthorizedError);
  });
});
