function sanitizeFilename(name: string): string {
  return name.replace(/["\\]/g, "_");
}

export function deliveryHeaders(contentType: string, publicId: string): Record<string, string> {
  const filename = sanitizeFilename(publicId.split("/").pop() ?? "file");
  return {
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    vary: "accept",
    "content-disposition": `inline; filename="${filename}"`,
    "x-content-type-options": "nosniff",
  };
}
