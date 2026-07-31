import { BadTransformError, parseTransforms, UnauthorizedError, verifySignature } from "@img/core";
import { Hono } from "hono";
import { ZodError } from "zod";
import { getConfig } from "./config";

export const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/:org/:transforms/:path{.+}", (c) => {
  const { org, transforms, path } = c.req.param();
  const config = getConfig();

  const transform = parseTransforms(transforms);
  if (config.requireSignedUrls) {
    verifySignature(c.req.path, config.signingKey);
  }

  return c.json({ org, publicId: path, transform });
});

app.onError((err, c) => {
  if (err instanceof BadTransformError) {
    return c.json({ error: "bad_transform", message: err.message }, 400);
  }
  if (err instanceof UnauthorizedError) {
    return c.json({ error: "unauthorized", message: err.message }, 401);
  }
  if (err instanceof ZodError) {
    return c.json({ error: "bad_transform", message: "invalid transform parameters" }, 400);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});
