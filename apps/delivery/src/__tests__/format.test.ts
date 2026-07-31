import { parseTransforms } from "@img/core";
import { describe, expect, it } from "vitest";
import { pickFormat, resolveFormat } from "../format";

describe("pickFormat", () => {
  it("prefers avif when the Accept header includes it", () => {
    expect(pickFormat("image/avif,image/webp,*/*")).toBe("avif");
  });

  it("prefers webp over jpg when avif is absent", () => {
    expect(pickFormat("image/webp,*/*")).toBe("webp");
  });

  it("falls back to jpg when no known image format is present", () => {
    expect(pickFormat("text/html")).toBe("jpg");
  });

  it("falls back to jpg when the Accept header is missing", () => {
    expect(pickFormat(undefined)).toBe("jpg");
  });
});

describe("resolveFormat", () => {
  it("negotiates via Accept when the transform requests auto", () => {
    const t = parseTransforms("w_100");
    expect(resolveFormat(t, "image/avif,*/*")).toEqual({
      ext: "avif",
      contentType: "image/avif",
      sharpFormat: "avif",
    });
  });

  it("honors an explicit format regardless of Accept", () => {
    const t = parseTransforms("w_100,f_png");
    expect(resolveFormat(t, "image/avif,*/*")).toEqual({
      ext: "png",
      contentType: "image/png",
      sharpFormat: "png",
    });
  });
});
