import {
  BadTransformError,
  parseTransforms,
  UnauthorizedError,
  verifySignature,
} from "@photon/core";
import { ObjectNotFoundError } from "@photon/storage";
import { Hono } from "hono";
import { ZodError } from "zod";
import { getConfig } from "./config";
import { resolveFormat } from "./format";
import {
  assertSafeOrg,
  assertSafePublicId,
  derivativeKey,
  originalKey,
  PathTraversalError,
} from "./keys";
import { persistDerivative } from "./persist-derivative";
import { renderDerivative, UnprocessableImageError } from "./render";
import { deliveryHeaders } from "./response";
import { getStorageClient } from "./storage";
import { streamToBuffer } from "./stream";
import { recordRequestUsage } from "./usage";

export const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/:org/:transforms/:path{.+}", async (c) => {
  const { org, transforms, path: publicId } = c.req.param();

  assertSafeOrg(org);
  assertSafePublicId(publicId);

  const config = getConfig();
  const transform = parseTransforms(transforms);
  if (config.requireSignedUrls) {
    verifySignature(c.req.path, config.signingKey);
  }

  const { ext, contentType, sharpFormat } = resolveFormat(transform, c.req.header("accept"));
  const storage = getStorageClient();
  const derivKey = derivativeKey(org, publicId, transform, ext);

  try {
    const cached = await storage.get(derivKey);
    const buffer = await streamToBuffer(cached.stream);
    recordRequestUsage(org, { transformed: false, bytes: buffer.length });
    return c.body(new Uint8Array(buffer), 200, deliveryHeaders(contentType, publicId));
  } catch (err) {
    if (!(err instanceof ObjectNotFoundError)) throw err;
  }

  let original: Awaited<ReturnType<typeof storage.get>>;
  try {
    original = await storage.get(originalKey(org, publicId));
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return c.notFound();
    throw err;
  }

  const originalBuffer = await streamToBuffer(original.stream);
  const buffer = await renderDerivative(originalBuffer, {
    transform,
    sharpFormat,
    quality: transform.q ?? 80,
  });

  persistDerivative(storage, derivKey, buffer, contentType);
  recordRequestUsage(org, { transformed: true, bytes: buffer.length });

  return c.body(new Uint8Array(buffer), 200, deliveryHeaders(contentType, publicId));
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  if (err instanceof PathTraversalError) {
    return c.json({ error: "bad_path", message: err.message }, 400);
  }
  if (err instanceof BadTransformError) {
    return c.json({ error: "bad_transform", message: err.message }, 400);
  }
  if (err instanceof UnauthorizedError) {
    return c.json({ error: "unauthorized", message: err.message }, 401);
  }
  if (err instanceof ZodError) {
    return c.json({ error: "bad_transform", message: "invalid transform parameters" }, 400);
  }
  if (err instanceof UnprocessableImageError) {
    return c.json({ error: "unprocessable_image", message: err.message }, 422);
  }
  if (err instanceof ObjectNotFoundError) {
    return c.json({ error: "not_found" }, 404);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});
