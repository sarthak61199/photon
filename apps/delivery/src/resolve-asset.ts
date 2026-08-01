import { TtlLruCache } from "@photon/utils";
import { getDbClient } from "./db";
import { AssetNotFoundError, AssetNotReadyError, OrgNotFoundError } from "./errors";

export interface ResolvedOrg {
  id: string;
  slug: string;
  urlSignKey: Buffer;
  requiresSignedUrls: boolean;
}

export interface ResolvedAsset {
  id: string;
  storageKey: string;
  status: string;
}

export interface ResolvedAssetLookup {
  org: ResolvedOrg;
  asset: ResolvedAsset;
}

const ASSET_CACHE_TTL_MS = 60_000;
const ASSET_CACHE_MAX_ENTRIES = 5000;

function createCache(): TtlLruCache<string, ResolvedAssetLookup> {
  return new TtlLruCache({ maxEntries: ASSET_CACHE_MAX_ENTRIES, ttlMs: ASSET_CACHE_TTL_MS });
}

let cache = createCache();

function cacheKey(orgSlug: string, publicId: string): string {
  return `${orgSlug}:${publicId}`;
}

export async function resolveAsset(
  orgSlug: string,
  publicId: string,
): Promise<ResolvedAssetLookup> {
  const key = cacheKey(orgSlug, publicId);
  const cached = cache.get(key);
  if (cached) return cached;

  const { db } = getDbClient();

  const org = await db.query.orgs.findFirst({
    where: (o, { eq }) => eq(o.slug, orgSlug),
  });
  if (!org) throw new OrgNotFoundError(orgSlug);

  const asset = await db.query.assets.findFirst({
    where: (a, { eq, and, isNull }) =>
      and(eq(a.orgId, org.id), eq(a.publicId, publicId), isNull(a.deletedAt)),
  });
  if (!asset) throw new AssetNotFoundError(publicId);
  if (asset.status !== "ready") throw new AssetNotReadyError(publicId, asset.status);

  const resolved: ResolvedAssetLookup = {
    org: {
      id: org.id,
      slug: org.slug,
      urlSignKey: org.urlSignKey,
      requiresSignedUrls: org.requiresSignedUrls,
    },
    asset: { id: asset.id, storageKey: asset.storageKey, status: asset.status },
  };

  cache.set(key, resolved);
  return resolved;
}

// Test-only: the cache is a module-level singleton so repeated resolutions
// within the 60s TTL don't hit Postgres; tests that reseed the same org/asset
// slugs between cases need a way to start from an empty cache.
export function resetAssetCache(): void {
  cache = createCache();
}
