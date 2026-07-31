import type { Transform } from "@photon/core";
import { fitMap } from "@photon/core";
import sharp from "sharp";
import { sharpLimit } from "./concurrency";
import type { SharpFormat } from "./format";

type SharpInstance = ReturnType<typeof sharp>;

const MAX_INPUT_PIXELS = 268_402_689; // ~16k x 16k, sharp's own decompression-bomb default, set explicitly

export class UnprocessableImageError extends Error {
  constructor(cause: unknown) {
    super("Unable to decode source image");
    this.name = "UnprocessableImageError";
    this.cause = cause;
  }
}

export interface RenderOptions {
  transform: Transform;
  sharpFormat: SharpFormat;
  quality: number;
}

function applyFormat(pipeline: SharpInstance, format: SharpFormat, quality: number): SharpInstance {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality });
    case "png":
      return pipeline.png({ quality });
    case "webp":
      return pipeline.webp({ quality, effort: 4 });
    case "avif":
      return pipeline.avif({ quality, effort: 4 });
  }
}

export function renderDerivative(input: Buffer, opts: RenderOptions): Promise<Buffer> {
  return sharpLimit(async () => {
    const { transform: t, sharpFormat, quality } = opts;
    try {
      let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();

      if (t.w || t.h) {
        pipeline = pipeline.resize({
          width: t.w ? Math.round(t.w * t.dpr) : undefined,
          height: t.h ? Math.round(t.h * t.dpr) : undefined,
          fit: fitMap[t.c],
          position: t.g,
          withoutEnlargement: true,
        });
      }
      if (t.blur) pipeline = pipeline.blur(t.blur / 3);

      return await applyFormat(pipeline, sharpFormat, quality).toBuffer();
    } catch (err) {
      throw new UnprocessableImageError(err);
    }
  });
}
