import type { Transform } from "@photon/core";
import { TransformSchema } from "@photon/core";
import { TtlLruCache } from "@photon/utils";
import { getDbClient } from "./db";
import { PresetNotFoundError } from "./errors";

const PRESET_CACHE_TTL_MS = 60_000;
const PRESET_CACHE_MAX_ENTRIES = 2000;

function createCache(): TtlLruCache<string, Transform> {
  return new TtlLruCache({ maxEntries: PRESET_CACHE_MAX_ENTRIES, ttlMs: PRESET_CACHE_TTL_MS });
}

let cache = createCache();

function cacheKey(orgId: string, name: string): string {
  return `${orgId}:${name}`;
}

export async function resolvePreset(orgId: string, name: string): Promise<Transform> {
  const key = cacheKey(orgId, name);
  const cached = cache.get(key);
  if (cached) return cached;

  const { db } = getDbClient();
  const preset = await db.query.transformPresets.findFirst({
    where: (p, { eq, and }) => and(eq(p.orgId, orgId), eq(p.name, name)),
  });
  if (!preset) throw new PresetNotFoundError(name);

  const transform = TransformSchema.parse(preset.params);
  cache.set(key, transform);
  return transform;
}

// Test-only, mirrors resolve-asset.ts's resetAssetCache.
export function resetPresetCache(): void {
  cache = createCache();
}
