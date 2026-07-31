import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  apiKeys,
  assets,
  derivatives,
  orgs,
  transformPresets,
  usageDaily,
  usageEvents,
  users,
  webhooks,
} from "../schema";

describe("table names", () => {
  it("resolves the expected Postgres table name for every table", () => {
    expect(getTableName(orgs)).toBe("orgs");
    expect(getTableName(users)).toBe("users");
    expect(getTableName(apiKeys)).toBe("api_keys");
    expect(getTableName(assets)).toBe("assets");
    expect(getTableName(transformPresets)).toBe("transform_presets");
    expect(getTableName(derivatives)).toBe("derivatives");
    expect(getTableName(usageEvents)).toBe("usage_events");
    expect(getTableName(usageDaily)).toBe("usage_daily");
    expect(getTableName(webhooks)).toBe("webhooks");
  });
});

describe("column shape", () => {
  it("orgs.slug is required and orgs.plan defaults to free", () => {
    expect(orgs.slug.notNull).toBe(true);
    expect(orgs.plan.default).toBe("free");
  });

  it("assets.deletedAt is nullable", () => {
    expect(assets.deletedAt.notNull).toBe(false);
  });
});

describe("api_keys", () => {
  it("has a partial index on key_hash for non-revoked rows", () => {
    const { indexes } = getTableConfig(apiKeys);
    const idx = indexes.find((i) => i.config.name === "api_keys_key_hash_active_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.where).toBeDefined();
  });
});

describe("assets", () => {
  it("has a GIN index on tags", () => {
    const { indexes } = getTableConfig(assets);
    const idx = indexes.find((i) => i.config.name === "assets_tags_gin_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.method).toBe("gin");
  });

  it("has a composite (org_id, created_at) index", () => {
    const { indexes } = getTableConfig(assets);
    const idx = indexes.find((i) => i.config.name === "assets_org_id_created_at_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.columns).toHaveLength(2);
  });

  it("has a unique constraint on (org_id, public_id)", () => {
    const { uniqueConstraints } = getTableConfig(assets);
    const uc = uniqueConstraints.find((u) => u.name === "assets_org_id_public_id_key");
    expect(uc).toBeDefined();
    expect(uc?.columns.map((c) => c.name)).toEqual(["org_id", "public_id"]);
  });
});

describe("derivatives", () => {
  it("cascades on asset deletion", () => {
    const { foreignKeys } = getTableConfig(derivatives);
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]?.onDelete).toBe("cascade");
  });
});

describe("usage_daily", () => {
  it("has a composite primary key on (org_id, day)", () => {
    const { primaryKeys } = getTableConfig(usageDaily);
    expect(primaryKeys).toHaveLength(1);
    expect(primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["org_id", "day"]);
  });
});

describe("usage_events", () => {
  it("has no primary key or foreign keys (partitioning deferred, see schema/usage.ts)", () => {
    const { primaryKeys, foreignKeys } = getTableConfig(usageEvents);
    expect(primaryKeys).toHaveLength(0);
    expect(foreignKeys).toHaveLength(0);
  });
});
