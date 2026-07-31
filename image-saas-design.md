# Image Service SaaS — Architecture & Design
### Stack: Hono + TypeScript + PostgreSQL (Cloudinary/Gumlet-style)

---

## 1. What the product does

Three core capabilities, same as Cloudinary/Gumlet:

1. **Ingest** — customers upload originals via API, dashboard, or "fetch from URL".
2. **Transform on the fly** — URL-driven transformations: resize, crop, format conversion (WebP/AVIF), quality, watermarks. `https://cdn.yourapp.com/acme/w_800,q_80,f_auto/products/shoe.jpg`
3. **Deliver** — via CDN with aggressive caching; derivatives are generated once and cached forever.

Plus SaaS scaffolding: multi-tenancy, API keys, usage metering, webhooks, billing.

---

## 2. High-level architecture

```
                            ┌──────────────────────────────┐
   Browser/App ────────────▶│  CDN (CloudFront / Bunny)     │
                            └───────────┬──────────────────┘
                                        │ cache miss
                     ┌──────────────────▼───────────────────┐
                     │  Delivery Service (Hono)             │
                     │  - parse transform URL               │
                     │  - verify signature                  │
                     │  - lookup asset (PG, cached)         │
                     │  - fetch original from S3            │
                     │  - transform with sharp              │
                     │  - stream + write derivative to S3   │
                     └───────┬──────────────────┬───────────┘
                             │                  │
        ┌────────────────────▼──┐        ┌──────▼──────────┐
        │ Object Storage        │        │ PostgreSQL      │
        │ (S3 / R2 / MinIO)     │        │ metadata, usage,│
        │ originals/derivatives │        │ tenants, queue  │
        └───────────▲───────────┘        └──────▲──────────┘
                    │                           │
                     ┌──────────────────────────┴───────────┐
                     │  API Service (Hono)                  │
                     │  - auth (API keys / JWT)             │
                     │  - upload (presigned / multipart)    │
                     │  - asset CRUD, search, tags          │
                     │  - webhooks, usage endpoints         │
                     └──────────────────┬───────────────────┘
                                        │ enqueue (pg-boss)
                     ┌──────────────────▼───────────────────┐
                     │  Workers (Node)                      │
                     │  - eager transforms, AI tagging      │
                     │  - fetch-from-URL ingest             │
                     │  - webhook delivery, usage rollups   │
                     └──────────────────────────────────────┘
```

**Key decisions**

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node 22 + Hono (`@hono/node-server`) | sharp needs native libvips; Hono keeps the option to move edge-safe routes to Workers later |
| Image engine | `sharp` | libvips: fast, streaming, AVIF/WebP support |
| Storage | S3-compatible (R2/S3/MinIO) | originals + derivative cache; cheap, infinite |
| Queue | `pg-boss` | job queue on Postgres — no Redis needed at the start |
| Cache of derivatives | S3 + CDN, **not** Postgres | derivative existence checked via S3 `HEAD`; PG only stores metadata |
| Multi-tenancy | Single DB, `org_id` on every row + composite indexes | simplest correct model; RLS optional later |

---

## 3. PostgreSQL schema

```sql
-- Tenancy ---------------------------------------------------------------
CREATE TABLE orgs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,            -- used in delivery URLs: /acme/...
  name          text NOT NULL,
  plan          text NOT NULL DEFAULT 'free',    -- free | pro | scale
  url_sign_key  bytea NOT NULL,                  -- HMAC key for signed delivery URLs
  settings      jsonb NOT NULL DEFAULT '{}',     -- default quality, allowed origins, etc.
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id),
  email      citext UNIQUE NOT NULL,
  role       text NOT NULL DEFAULT 'member',     -- owner | admin | member
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  name        text NOT NULL,
  key_prefix  text NOT NULL,                     -- first 8 chars, for display
  key_hash    text NOT NULL,                     -- sha256 of full key
  scopes      text[] NOT NULL DEFAULT '{read,write}',
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON api_keys (key_hash) WHERE revoked_at IS NULL;

-- Assets ----------------------------------------------------------------
CREATE TABLE assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  public_id    text NOT NULL,                    -- 'products/shoe' (customer-facing path)
  storage_key  text NOT NULL,                    -- 'orgs/{org}/orig/{id}' in S3
  status       text NOT NULL DEFAULT 'pending',  -- pending | ready | failed | deleted
  mime_type    text,
  bytes        bigint,
  width        int,
  height       int,
  checksum     text,                             -- sha256, dedupe + ETag
  metadata     jsonb NOT NULL DEFAULT '{}',      -- EXIF, dominant color, blurhash
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (org_id, public_id)
);
CREATE INDEX ON assets (org_id, created_at DESC);
CREATE INDEX ON assets USING gin (tags);

-- Named transform presets ("t_thumbnail") -------------------------------
CREATE TABLE transform_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id),
  name       text NOT NULL,                      -- referenced in URLs as t_name
  params     jsonb NOT NULL,                     -- {"w":300,"h":300,"fit":"cover","f":"auto"}
  UNIQUE (org_id, name)
);

-- Derivative registry (optional but useful for purge & analytics) -------
CREATE TABLE derivatives (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  transform_key text NOT NULL,                   -- canonical param string 'f_webp,q_80,w_800'
  storage_key   text NOT NULL,
  bytes         bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, transform_key)
);

-- Usage metering --------------------------------------------------------
-- Raw events written by delivery service (batched); rolled up by worker.
CREATE TABLE usage_events (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  org_id     uuid NOT NULL,
  kind       text NOT NULL,          -- request | transform | storage_snapshot | bandwidth
  quantity   bigint NOT NULL,        -- bytes for bandwidth, 1 for requests
  occurred_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (occurred_at);  -- monthly partitions

CREATE TABLE usage_daily (
  org_id      uuid NOT NULL,
  day         date NOT NULL,
  requests    bigint NOT NULL DEFAULT 0,
  transforms  bigint NOT NULL DEFAULT 0,
  bandwidth   bigint NOT NULL DEFAULT 0,
  storage     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day)
);

-- Webhooks --------------------------------------------------------------
CREATE TABLE webhooks (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   uuid NOT NULL REFERENCES orgs(id),
  url      text NOT NULL,
  secret   text NOT NULL,
  events   text[] NOT NULL DEFAULT '{asset.ready,asset.failed}'
);
```

---

## 4. Project layout

```
apps/
  api/            # Hono — management API (auth'd, JSON)
  delivery/       # Hono — hot path, transforms, minimal deps
  worker/         # pg-boss consumers
packages/
  db/             # drizzle schema + client (or kysely)
  core/           # transform parser, url signing, shared types
  storage/        # S3 client wrapper
```

Two separate Hono apps matter: **delivery must never be slowed by API concerns** (heavy middleware, ORM overhead) and scales independently (CPU-bound sharp work).

---

## 5. The delivery hot path (the heart of the product)

### URL format

```
https://cdn.app.com/{orgSlug}/{transforms}/{publicId}
https://cdn.app.com/acme/w_800,h_600,c_fill,f_auto,q_80/products/shoe.jpg
https://cdn.app.com/acme/t_thumbnail/products/shoe.jpg          # preset
https://cdn.app.com/acme/s_9f8ab2.../w_800/products/shoe.jpg    # signed
```

### Transform parser (`packages/core/transforms.ts`)

```ts
import { z } from "zod";

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
```

Canonicalizing means `w_800,q_80` and `q_80,w_800` hit the same cached derivative.

### Delivery route (`apps/delivery/src/index.ts`)

```ts
import { Hono } from "hono";
import sharp from "sharp";

const app = new Hono();

app.get("/:org/:transforms/:path{.+}", async (c) => {
  const { org, transforms, path } = c.req.param();

  // 1. Resolve org + asset. Cache in-process (LRU, 60s TTL) — this lookup
  //    happens on every CDN miss and must not hammer PG.
  const asset = await assetCache.resolve(org, path);
  if (!asset || asset.status !== "ready") return c.notFound();

  // 2. Parse + verify
  const t = parseTransforms(transforms);
  if (asset.org.requiresSignedUrls) verifySignature(c.req, asset.org.urlSignKey);

  // 3. Negotiate f_auto via Accept header
  const ext = t.f === "auto" ? pickFormat(c.req.header("accept")) : t.f;
  const key = `orgs/${asset.orgId}/deriv/${asset.id}/${transformKey(t, ext)}`;

  // 4. Derivative already exists? Redirect/stream from S3.
  const existing = await storage.head(key);
  if (existing) return streamFromStorage(c, key, ext);

  // 5. Transform: stream original from S3 through sharp
  const original = await storage.getStream(asset.storageKey);
  let pipe = sharp().rotate(); // honor EXIF orientation

  if (t.w || t.h) {
    pipe = pipe.resize({
      width: t.w ? Math.round(t.w * t.dpr) : undefined,
      height: t.h ? Math.round(t.h * t.dpr) : undefined,
      fit: fitMap[t.c],           // fill→cover, fit→inside, pad→contain...
      position: t.g,
      withoutEnlargement: true,
    });
  }
  if (t.blur) pipe = pipe.blur(t.blur / 3);
  pipe = pipe.toFormat(ext, { quality: t.q ?? 80, effort: 4 });

  const buf = await original.pipe(pipe).toBuffer();

  // 6. Write-behind: persist derivative + register + meter (don't block response)
  c.executionCtx?.waitUntil?.(persistDerivative(key, buf, asset, t)) 
    ?? void persistDerivative(key, buf, asset, t);

  return c.body(buf, 200, {
    "content-type": `image/${ext}`,
    "cache-control": "public, max-age=31536000, immutable",
    "vary": "accept",   // required because of f_auto
  });
});
```

**Hot-path rules**

- No ORM here — one prepared statement behind the LRU cache.
- `Vary: Accept` is essential with `f_auto`, or the CDN serves AVIF to Safari 14.
- Cap concurrent sharp operations (`p-limit` ~ 2×CPU cores) or a traffic spike OOMs the box.
- Reject absurd params early (the zod schema is your DoS guard: max 5000px, dpr ≤ 3).

### Signed URLs (prevent transform abuse)

Anyone who can guess your URL scheme can make you burn CPU generating 5000px AVIFs. Signature = HMAC over the *path after the signature segment*:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(path: string, key: Buffer): string {
  return createHmac("sha256", key).update(path).digest("base64url").slice(0, 16);
}

export function verifySignature(req: HonoRequest, key: Buffer) {
  const m = req.path.match(/^\/[^/]+\/s_([^,/]+)[,/](.+)$/);
  if (!m) throw new UnauthorizedError();
  const [, sig, rest] = m;
  const expected = sign(rest, key);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();
}
```

Free plans can run unsigned but rate-limited; paid plans toggle `requiresSignedUrls`.

---

## 6. Management API (apps/api)

### Auth middleware

```ts
import { createMiddleware } from "hono/factory";
import { createHash } from "node:crypto";

export const apiKeyAuth = createMiddleware<{ Variables: { orgId: string } }>(
  async (c, next) => {
    const header = c.req.header("authorization");
    const key = header?.replace(/^Bearer /, "");
    if (!key) return c.json({ error: "missing_api_key" }, 401);

    const hash = createHash("sha256").update(key).digest("hex");
    const row = await db.query.apiKeys.findFirst({
      where: (k, { eq, isNull, and }) => and(eq(k.keyHash, hash), isNull(k.revokedAt)),
    });
    if (!row) return c.json({ error: "invalid_api_key" }, 401);

    c.set("orgId", row.orgId);
    await next();
  },
);
```

### Endpoints

```
POST   /v1/uploads                → presigned S3 POST + pending asset row
POST   /v1/uploads/complete      → client confirms; enqueue 'process-asset'
POST   /v1/assets/fetch          → ingest from remote URL (worker job)
GET    /v1/assets?tag=&cursor=   → keyset-paginated listing
GET    /v1/assets/:publicId
PATCH  /v1/assets/:publicId      → tags, metadata
DELETE /v1/assets/:publicId      → soft delete + purge job
POST   /v1/presets               → named transforms
POST   /v1/purge                 → CDN + derivative invalidation
GET    /v1/usage?from=&to=       → reads usage_daily
POST   /v1/webhooks
```

### Upload flow (presigned — originals never pass through your API)

```ts
app.post("/v1/uploads", apiKeyAuth, async (c) => {
  const { publicId, contentType } = await c.req.json();
  const assetId = crypto.randomUUID();
  const storageKey = `orgs/${c.get("orgId")}/orig/${assetId}`;

  await db.insert(assets).values({
    id: assetId, orgId: c.get("orgId"), publicId, storageKey, status: "pending",
  });

  const presigned = await storage.presignPost(storageKey, {
    contentType, maxBytes: 50 * 1024 * 1024, expiresIn: 900,
  });
  return c.json({ assetId, upload: presigned });
});
```

On `complete`, a worker downloads headers/first bytes, validates it's a real image (magic bytes via sharp `metadata()` — never trust Content-Type), extracts dimensions/EXIF/blurhash, computes checksum, flips `status='ready'`, and fires the `asset.ready` webhook.

---

## 7. Workers (pg-boss)

```ts
import PgBoss from "pg-boss";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();

await boss.work("process-asset", { batchSize: 5 }, processAsset);   // validate, metadata, eager presets
await boss.work("fetch-url",     { batchSize: 5 }, fetchFromUrl);
await boss.work("deliver-webhook", { retryLimit: 8, retryBackoff: true }, deliverWebhook);
await boss.schedule("rollup-usage", "*/5 * * * *");                  // usage_events → usage_daily
await boss.schedule("storage-snapshot", "0 2 * * *");                // nightly per-org bytes
```

**Usage metering pattern:** the delivery service buffers events in memory and flushes a multi-row `INSERT` into `usage_events` every ~5s. The rollup job aggregates into `usage_daily` and deletes/detaches old partitions. Billing (Stripe metered usage) reads `usage_daily`.

---

## 8. Security & abuse checklist

- **SSRF** on fetch-from-URL: resolve DNS, block private ranges (127/8, 10/8, 169.254/16, ::1), disallow redirects to them too.
- **Decompression bombs**: `sharp({ limitInputPixels: 268402689 })` (default ~16k×16k) + input size caps.
- **Transform abuse**: signed URLs + param limits + per-org token-bucket rate limit (in-memory in delivery, PG-backed in API).
- **Key handling**: show full API key once; store only hash + prefix.
- **Tenant isolation**: every query filters `org_id`; enforce with a repository layer (or PG RLS if you want defense in depth).
- **Content**: `Content-Disposition` and `X-Content-Type-Options: nosniff` on delivery.

---

## 9. Scaling path

| Stage | Bottleneck | Move |
|---|---|---|
| MVP | — | 1 box: both Hono apps + worker, managed PG, R2, Bunny CDN |
| ~10M req/mo | sharp CPU | separate delivery fleet, autoscale on CPU |
| ~100M req/mo | PG lookups on cache misses | add Redis for asset lookups; move pg-boss → dedicated queue if job volume high |
| Later | latency | multi-region delivery (originals in R2 = free egress), edge lookup via replicated KV |
| Later | usage_events volume | ship events to ClickHouse/Tinybird, keep PG for daily rollups only |

The design keeps Postgres as the single source of truth throughout — you add caches in front of it, never a second database of record.

---

## 10. MVP build order

1. `packages/core` — transform parser + URL signing (pure, fully unit-testable).
2. Delivery service against a hardcoded org + local MinIO.
3. Schema + migrations (drizzle-kit), API keys, presigned upload flow.
4. `process-asset` worker + webhooks.
5. Usage metering + `/v1/usage`.
6. CDN in front, `f_auto` + `Vary`, signed URLs.
7. Dashboard (separate app, talks to the same API).
