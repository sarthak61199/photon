import sharp from "sharp";

export async function createFixtureJpeg(opts?: {
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const width = opts?.width ?? 40;
  const height = opts?.height ?? 20;
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
}
