import { z } from "zod";
import { BadTransformError } from "./errors";

export const TransformSchema = z.object({
  w: z.coerce.number().int().min(1).max(5000).optional(),
  h: z.coerce.number().int().min(1).max(5000).optional(),
  c: z.enum(["fill", "fit", "crop", "pad", "scale"]).default("fit"),
  g: z.enum(["center", "north", "south", "east", "west", "auto"]).default("center"),
  q: z.coerce.number().int().min(1).max(100).optional(),
  f: z.enum(["auto", "jpg", "png", "webp", "avif"]).default("auto"),
  dpr: z.coerce.number().min(1).max(3).default(1),
  blur: z.coerce.number().int().min(1).max(100).optional(),
});
export type Transform = z.infer<typeof TransformSchema>;

export function parseTransforms(segment: string): Transform {
  const raw: Record<string, string> = {};
  for (const part of segment.split(",")) {
    const idx = part.indexOf("_");
    if (idx === -1) throw new BadTransformError(part);
    raw[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return TransformSchema.parse(raw);
}

// Canonical key: sorted params → cache key & derivative storage key.
export function transformKey(t: Transform, ext: string): string {
  const entries = Object.entries(t)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}_${v}`);
  return `${entries.join(",")}.${ext}`;
}

export type SharpFit = "cover" | "contain" | "fill" | "inside" | "outside";

export const fitMap: Record<Transform["c"], SharpFit> = {
  fill: "cover",
  fit: "inside",
  pad: "contain",
  crop: "cover",
  scale: "fill",
};
