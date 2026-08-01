import {
  BadTransformError,
  parseTransforms,
  transformKey,
  UnauthorizedError,
  verifySignature,
} from "@photon/core";
import { ObjectNotFoundError } from "@photon/storage";
import { Hono } from "hono";
import { ZodError } from "zod";
import { getDbClient } from "./db";
import { AssetNotFoundError, AssetNotReadyError, OrgNotFoundError } from "./errors";
import { resolveFormat } from "./format";
import { assertSafeOrg, assertSafePublicId, derivativeKey, PathTraversalError } from "./keys";
import { persistDerivative } from "./persist-derivative";
import { renderDerivative, UnprocessableImageError } from "./render";
import { resolveAsset } from "./resolve-asset";
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

  const transform = parseTransforms(transforms);
  const { org: resolvedOrg, asset } = await resolveAsset(org, publicId);

  if (resolvedOrg.requiresSignedUrls) {
    verifySignature(c.req.path, resolvedOrg.urlSignKey);
  }

  const { ext, contentType, sharpFormat } = resolveFormat(transform, c.req.header("accept"));
  const storage = getStorageClient();
  const derivKey = derivativeKey(resolvedOrg.id, asset.id, transform, ext);

  try {
    const cached = await storage.get(derivKey);
    const buffer = await streamToBuffer(cached.stream);
    recordRequestUsage(resolvedOrg.id, { transformed: false, bytes: buffer.length });
    return c.body(new Uint8Array(buffer), 200, deliveryHeaders(contentType, publicId));
  } catch (err) {
    if (!(err instanceof ObjectNotFoundError)) throw err;
  }

  const original = await storage.get(asset.storageKey);
  const originalBuffer = await streamToBuffer(original.stream);
  const buffer = await renderDerivative(originalBuffer, {
    transform,
    sharpFormat,
    quality: transform.q ?? 80,
  });

  persistDerivative(storage, getDbClient(), derivKey, buffer, contentType, {
    assetId: asset.id,
    transformKey: transformKey(transform, ext),
  });
  recordRequestUsage(resolvedOrg.id, { transformed: true, bytes: buffer.length });

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
  if (
    err instanceof ObjectNotFoundError ||
    err instanceof OrgNotFoundError ||
    err instanceof AssetNotFoundError ||
    err instanceof AssetNotReadyError
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});
