import { describe, expect, it } from "vitest";
import { BadTransformError } from "../errors";
import {
  fitMap,
  parseTransforms,
  type SharpFit,
  type Transform,
  transformKey,
} from "../transforms";

describe("parseTransforms", () => {
  it("parses a full set of params", () => {
    const t = parseTransforms("w_800,h_600,c_fill,f_auto,q_80");
    expect(t).toEqual({
      w: 800,
      h: 600,
      c: "fill",
      g: "center",
      q: 80,
      f: "auto",
      dpr: 1,
      blur: undefined,
    });
  });

  it("fills in defaults for omitted params", () => {
    const t = parseTransforms("w_800");
    expect(t.w).toBe(800);
    expect(t.c).toBe("fit");
    expect(t.g).toBe("center");
    expect(t.f).toBe("auto");
    expect(t.dpr).toBe(1);
    expect(t.h).toBeUndefined();
    expect(t.q).toBeUndefined();
    expect(t.blur).toBeUndefined();
  });

  it("throws BadTransformError on a segment with no underscore", () => {
    expect(() => parseTransforms("w800")).toThrow(BadTransformError);
    try {
      parseTransforms("w800");
    } catch (err) {
      expect(err).toBeInstanceOf(BadTransformError);
      expect((err as BadTransformError).message).toContain("w800");
    }
  });

  it("throws BadTransformError on an empty part from a double comma", () => {
    expect(() => parseTransforms("w_800,,h_600")).toThrow(BadTransformError);
  });

  it("throws on out-of-range width", () => {
    expect(() => parseTransforms("w_99999")).toThrow();
  });

  it("throws on out-of-range dpr", () => {
    expect(() => parseTransforms("dpr_5")).toThrow();
  });

  it("throws on out-of-range quality", () => {
    expect(() => parseTransforms("q_0")).toThrow();
  });

  it("throws on an invalid enum value", () => {
    expect(() => parseTransforms("c_stretch")).toThrow();
  });

  it("silently strips unknown keys", () => {
    const t = parseTransforms("zzz_1,w_800");
    expect(t.w).toBe(800);
    expect(t).not.toHaveProperty("zzz");
  });
});

describe("transformKey", () => {
  it("produces the expected canonical string", () => {
    const t: Transform = { w: 800, h: 600, c: "fill", g: "center", f: "jpg", dpr: 1 };
    expect(transformKey(t, "jpg")).toBe("c_fill,dpr_1,f_jpg,g_center,h_600,w_800.jpg");
  });

  it("is order-independent", () => {
    const a = transformKey(parseTransforms("w_800,q_80"), "jpg");
    const b = transformKey(parseTransforms("q_80,w_800"), "jpg");
    expect(a).toBe(b);
  });

  it("excludes undefined fields instead of rendering them", () => {
    const key = transformKey(parseTransforms("w_800"), "jpg");
    expect(key).not.toContain("blur_undefined");
    expect(key).not.toContain("q_undefined");
    expect(key).not.toContain("h_undefined");
  });
});

describe("fitMap", () => {
  it("maps all five c values to the expected sharp fit", () => {
    const expected: Record<Transform["c"], SharpFit> = {
      fill: "cover",
      fit: "inside",
      pad: "contain",
      crop: "cover",
      scale: "fill",
    };
    expect(fitMap).toEqual(expected);
  });
});
