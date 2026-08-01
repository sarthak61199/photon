import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../errors";

describe("isUniqueViolation", () => {
  it("returns true for a flat postgres error (code on the error itself)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("returns true when the code is nested under .cause (real drizzle-orm shape)", () => {
    const drizzleError = { message: "Failed query", cause: { code: "23505" } };
    expect(isUniqueViolation(drizzleError)).toBe(true);
  });

  it("returns true for a deeper cause chain", () => {
    const err = { cause: { cause: { code: "23505" } } };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns false for an unrelated postgres error code", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
  });
});
