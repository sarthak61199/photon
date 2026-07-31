import { randomUUID } from "node:crypto";
import { assets } from "@photon/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { ZodError, z } from "zod";
import { apiKeyAuth, requireScope } from "./auth";
import { getDbClient } from "./db";
import {
  AssetNotFoundError,
  BadCursorError,
  DuplicatePublicIdError,
  InsufficientScopeError,
  InvalidApiKeyError,
  isUniqueViolation,
  MissingApiKeyError,
} from "./errors";
import { enqueueProcessAsset } from "./queue";
import { getStorageClient } from "./storage";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_URL_EXPIRY_SECONDS = 900;

const CreateUploadSchema = z.object({
  publicId: z.string().min(1).max(512),
  contentType: z.string().min(1),
});

const CompleteUploadSchema = z.object({
  assetId: z.uuid(),
});

const ListAssetsQuerySchema = z.object({
  tag: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const UpdateAssetSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.tags !== undefined || v.metadata !== undefined, {
    message: "at least one of tags or metadata must be provided",
  });

interface AssetCursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(row: AssetCursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): AssetCursor {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = iso ? new Date(iso) : undefined;
  if (!iso || !id || !createdAt || Number.isNaN(createdAt.getTime())) {
    throw new BadCursorError(cursor);
  }
  return { createdAt, id };
}

export const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.post("/v1/uploads", apiKeyAuth, requireScope("write"), async (c) => {
  const { publicId, contentType } = CreateUploadSchema.parse(await c.req.json());
  const orgId = c.get("orgId");
  const assetId = randomUUID();
  const storageKey = `orgs/${orgId}/orig/${assetId}`;
  const { db } = getDbClient();

  try {
    await db.insert(assets).values({ id: assetId, orgId, publicId, storageKey, status: "pending" });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicatePublicIdError(publicId);
    throw err;
  }

  const storage = getStorageClient();
  const upload = await storage.presignPost(storageKey, {
    contentType,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: UPLOAD_URL_EXPIRY_SECONDS,
  });

  return c.json({ assetId, storageKey, upload }, 201);
});

app.post("/v1/uploads/complete", apiKeyAuth, requireScope("write"), async (c) => {
  const { assetId } = CompleteUploadSchema.parse(await c.req.json());
  const orgId = c.get("orgId");
  const { db } = getDbClient();

  const row = await db.query.assets.findFirst({
    where: (a, { eq, and, isNull }) =>
      and(eq(a.id, assetId), eq(a.orgId, orgId), isNull(a.deletedAt)),
  });
  if (!row) throw new AssetNotFoundError(assetId);

  await enqueueProcessAsset(assetId);

  return c.json({ assetId, status: row.status });
});

app.get("/v1/assets", apiKeyAuth, async (c) => {
  const { tag, cursor, limit } = ListAssetsQuerySchema.parse(c.req.query());
  const orgId = c.get("orgId");
  const { db } = getDbClient();

  const cursorTuple = cursor ? decodeCursor(cursor) : undefined;

  const rows = await db.query.assets.findMany({
    where: (a, { eq, and, isNull, or, lt, sql }) =>
      and(
        eq(a.orgId, orgId),
        isNull(a.deletedAt),
        tag ? sql`${tag} = ANY(${a.tags})` : undefined,
        cursorTuple
          ? or(
              lt(a.createdAt, cursorTuple.createdAt),
              and(eq(a.createdAt, cursorTuple.createdAt), lt(a.id, cursorTuple.id)),
            )
          : undefined,
      ),
    orderBy: (a, { desc }) => [desc(a.createdAt), desc(a.id)],
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;

  return c.json({ assets: page, nextCursor });
});

app.get("/v1/assets/:publicId", apiKeyAuth, async (c) => {
  const publicId = c.req.param("publicId");
  const orgId = c.get("orgId");
  const { db } = getDbClient();

  const row = await db.query.assets.findFirst({
    where: (a, { eq, and, isNull }) =>
      and(eq(a.orgId, orgId), eq(a.publicId, publicId), isNull(a.deletedAt)),
  });
  if (!row) throw new AssetNotFoundError(publicId);

  return c.json(row);
});

app.patch("/v1/assets/:publicId", apiKeyAuth, requireScope("write"), async (c) => {
  const publicId = c.req.param("publicId");
  const orgId = c.get("orgId");
  const patch = UpdateAssetSchema.parse(await c.req.json());
  const { db } = getDbClient();

  const existing = await db.query.assets.findFirst({
    where: (a, { eq, and, isNull }) =>
      and(eq(a.orgId, orgId), eq(a.publicId, publicId), isNull(a.deletedAt)),
  });
  if (!existing) throw new AssetNotFoundError(publicId);

  const [row] = await db
    .update(assets)
    .set({
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
    })
    .where(eq(assets.id, existing.id))
    .returning();

  if (!row) throw new AssetNotFoundError(publicId);
  return c.json(row);
});

app.delete("/v1/assets/:publicId", apiKeyAuth, requireScope("write"), async (c) => {
  const publicId = c.req.param("publicId");
  const orgId = c.get("orgId");
  const { db } = getDbClient();

  const existing = await db.query.assets.findFirst({
    where: (a, { eq, and, isNull }) =>
      and(eq(a.orgId, orgId), eq(a.publicId, publicId), isNull(a.deletedAt)),
  });
  if (!existing) throw new AssetNotFoundError(publicId);

  const [row] = await db
    .update(assets)
    .set({ deletedAt: new Date() })
    .where(eq(assets.id, existing.id))
    .returning();

  if (!row) throw new AssetNotFoundError(publicId);
  return c.body(null, 204);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  if (err instanceof MissingApiKeyError) return c.json({ error: "missing_api_key" }, 401);
  if (err instanceof InvalidApiKeyError) return c.json({ error: "invalid_api_key" }, 401);
  if (err instanceof InsufficientScopeError) {
    return c.json({ error: "insufficient_scope", message: err.message }, 403);
  }
  if (err instanceof DuplicatePublicIdError) {
    return c.json({ error: "duplicate_public_id", message: err.message }, 409);
  }
  if (err instanceof AssetNotFoundError) return c.json({ error: "not_found" }, 404);
  if (err instanceof BadCursorError) return c.json({ error: "bad_cursor" }, 400);
  if (err instanceof ZodError) {
    return c.json({ error: "bad_request", message: "invalid request parameters" }, 400);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});
