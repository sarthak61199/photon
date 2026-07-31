import type { Transform } from "@photon/core";

export type ConcreteFormat = "jpg" | "png" | "webp" | "avif";
export type SharpFormat = "jpeg" | "png" | "webp" | "avif";

interface FormatInfo {
  ext: ConcreteFormat;
  contentType: string;
  sharpFormat: SharpFormat;
}

const FORMATS: Record<ConcreteFormat, FormatInfo> = {
  jpg: { ext: "jpg", contentType: "image/jpeg", sharpFormat: "jpeg" },
  png: { ext: "png", contentType: "image/png", sharpFormat: "png" },
  webp: { ext: "webp", contentType: "image/webp", sharpFormat: "webp" },
  avif: { ext: "avif", contentType: "image/avif", sharpFormat: "avif" },
};

export function pickFormat(accept: string | undefined): ConcreteFormat {
  if (accept?.includes("image/avif")) return "avif";
  if (accept?.includes("image/webp")) return "webp";
  return "jpg";
}

export function resolveFormat(t: Transform, accept: string | undefined): FormatInfo {
  const f = t.f === "auto" ? pickFormat(accept) : t.f;
  return FORMATS[f];
}
