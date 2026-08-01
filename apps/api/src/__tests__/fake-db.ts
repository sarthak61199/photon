import { randomUUID } from "node:crypto";
import type {
  ApiKey,
  Asset,
  DbClient,
  NewApiKey,
  NewAsset,
  NewOrg,
  NewUsageDaily,
  Org,
  TransformPreset,
  UsageDaily,
  Webhook,
} from "@photon/db";
import { apiKeys, assets, orgs, transformPresets, webhooks } from "@photon/db";
import { is, Param, type SQL } from "drizzle-orm";

type Row = Record<string, unknown>;
type Predicate<T> = (row: T) => boolean;

class FakeUniqueViolationError extends Error {
  code = "23505";
  constructor() {
    super("duplicate key value violates unique constraint");
  }
}

// The `where`/`orderBy` callbacks passed to db.query.<table>.findFirst/findMany
// receive a "fields" object as their first argument. Real drizzle passes real
// Column objects; this fake just needs something whose property access
// returns the field name, since our own eq/isNull/etc below only care about
// which key to compare on a plain JS row.
function makeFieldProxy<T extends Row>(): T {
  return new Proxy({}, { get: (_target, prop) => prop }) as T;
}

function makeThenable<T>(promise: Promise<T>) {
  return {
    // biome-ignore lint/suspicious/noThenProperty: intentionally mimics drizzle's awaitable query builders
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function makeWhereOperators<T extends Row>() {
  return {
    eq:
      (field: keyof T, val: unknown): Predicate<T> =>
      (row) =>
        row[field] === val,
    and:
      (...preds: (Predicate<T> | undefined)[]): Predicate<T> =>
      (row) =>
        preds.every((p) => !p || p(row)),
    or:
      (...preds: (Predicate<T> | undefined)[]): Predicate<T> =>
      (row) =>
        preds.some((p) => p?.(row)),
    isNull:
      (field: keyof T): Predicate<T> =>
      (row) =>
        row[field] == null,
    lt:
      (field: keyof T, val: unknown): Predicate<T> =>
      (row) => {
        const a = row[field];
        return a != null && (a as never) < (val as never);
      },
    gte:
      (field: keyof T, val: unknown): Predicate<T> =>
      (row) => {
        const a = row[field];
        return a != null && (a as never) >= (val as never);
      },
    lte:
      (field: keyof T, val: unknown): Predicate<T> =>
      (row) => {
        const a = row[field];
        return a != null && (a as never) <= (val as never);
      },
    // Only ever used for the `${tag} = ANY(${a.tags})` case in this app.
    sql:
      (_strings: TemplateStringsArray, val: unknown, field: keyof T): Predicate<T> =>
      (row) => {
        const arr = row[field];
        return Array.isArray(arr) && arr.includes(val);
      },
  };
}

interface OrderSpec<T> {
  field: keyof T;
  dir: "asc" | "desc";
}

function makeOrderByOperators<T extends Row>() {
  return {
    asc: (field: keyof T): OrderSpec<T> => ({ field, dir: "asc" }),
    desc: (field: keyof T): OrderSpec<T> => ({ field, dir: "desc" }),
  };
}

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function sortRows<T extends Row>(rows: T[], orders: OrderSpec<T>[]): T[] {
  return [...rows].sort((a, b) => {
    for (const { field, dir } of orders) {
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

interface FindConfig<T extends Row> {
  where?: (fields: T, ops: ReturnType<typeof makeWhereOperators<T>>) => Predicate<T> | undefined;
}

interface FindManyConfig<T extends Row> extends FindConfig<T> {
  orderBy?: (fields: T, ops: ReturnType<typeof makeOrderByOperators<T>>) => OrderSpec<T>[];
  limit?: number;
}

function createRelationalQuery<T extends Row>(store: Map<string, T>) {
  return {
    async findFirst(config?: FindConfig<T>): Promise<T | undefined> {
      const rows = [...store.values()];
      const predicate = config?.where?.(makeFieldProxy<T>(), makeWhereOperators<T>());
      return predicate ? rows.find(predicate) : rows[0];
    },
    async findMany(config?: FindManyConfig<T>): Promise<T[]> {
      let rows = [...store.values()];
      const predicate = config?.where?.(makeFieldProxy<T>(), makeWhereOperators<T>());
      if (predicate) rows = rows.filter(predicate);
      const orders = config?.orderBy?.(makeFieldProxy<T>(), makeOrderByOperators<T>());
      if (orders) rows = sortRows(rows, orders);
      if (config?.limit !== undefined) rows = rows.slice(0, config.limit);
      return rows;
    },
  };
}

// A real eq(table.column, value) — the only shape this app's `.where()`
// calls after `.update()` ever produce (always keyed on the primary `id`
// column) — compiles to an SQL whose queryChunks include a Param holding
// the raw value. We only need that value: the fake always matches by id.
function extractEqValue(condition: SQL): unknown {
  for (const chunk of condition.queryChunks) {
    if (is(chunk, Param)) return chunk.value;
  }
  throw new Error("fake db: unsupported where() condition — expected a simple eq(table.id, value)");
}

function createUpdateBuilder<T extends Row>(store: Map<string, T>) {
  return {
    set(patch: Partial<T>) {
      return {
        where(condition: SQL) {
          const id = extractEqValue(condition) as string;
          const promise = (async () => {
            const row = store.get(id);
            if (!row) return [];
            const next = { ...row, ...patch };
            store.set(id, next);
            return [next];
          })();
          return { ...makeThenable(promise), returning: () => promise };
        },
      };
    },
  };
}

function createInsertBuilder<T extends Row>(
  store: Map<string, T>,
  opts: { uniqueOn?: (keyof T)[]; defaults?: Partial<T> } = {},
) {
  return {
    values(row: T) {
      const promise = (async () => {
        const id = (row.id as string | undefined) ?? randomUUID();
        const full = {
          ...opts.defaults,
          ...row,
          id,
          createdAt: (row as Row).createdAt ?? new Date(),
        } as T;
        if (opts.uniqueOn) {
          const dup = [...store.values()].some((existing) =>
            opts.uniqueOn?.every((k) => existing[k] === full[k]),
          );
          if (dup) throw new FakeUniqueViolationError();
        }
        store.set(id, full);
        return full;
      })();
      return { ...makeThenable(promise), returning: () => promise.then((r) => [r]) };
    },
  };
}

export interface FakeDb {
  seedOrg(org: Partial<NewOrg> & { id?: string }): Org;
  seedApiKey(apiKey: Partial<NewApiKey> & { orgId: string }): ApiKey;
  seedAsset(asset: Partial<NewAsset> & { orgId: string; publicId: string }): Asset;
  getAsset(id: string): Asset | undefined;
  seedUsageDaily(row: Partial<NewUsageDaily> & { orgId: string; day: string }): UsageDaily;
  getWebhooks(): Webhook[];
  getTransformPresets(): TransformPreset[];
  clear(): void;
}

export function createFakeDbClient(): DbClient & { fake: FakeDb } {
  const orgsStore = new Map<string, Org>();
  const apiKeysStore = new Map<string, ApiKey>();
  const assetsStore = new Map<string, Asset>();
  const usageDailyStore = new Map<string, UsageDaily>();
  const webhooksStore = new Map<string, Webhook>();
  const transformPresetsStore = new Map<string, TransformPreset>();

  const fake: FakeDb = {
    seedOrg(org) {
      const id = org.id ?? randomUUID();
      const full: Org = {
        id,
        slug: org.slug ?? `org-${id.slice(0, 8)}`,
        name: org.name ?? "Test Org",
        plan: org.plan ?? "free",
        urlSignKey: org.urlSignKey ?? Buffer.from("test-signing-key"),
        requiresSignedUrls: org.requiresSignedUrls ?? false,
        settings: org.settings ?? {},
        createdAt: org.createdAt ?? new Date(),
      };
      orgsStore.set(id, full);
      return full;
    },
    seedApiKey(apiKey) {
      const id = apiKey.id ?? randomUUID();
      const full: ApiKey = {
        id,
        orgId: apiKey.orgId,
        name: apiKey.name ?? "test key",
        keyPrefix: apiKey.keyPrefix ?? "testpfx",
        keyHash: apiKey.keyHash ?? "test-hash",
        scopes: apiKey.scopes ?? ["read", "write"],
        lastUsedAt: apiKey.lastUsedAt ?? null,
        revokedAt: apiKey.revokedAt ?? null,
        createdAt: apiKey.createdAt ?? new Date(),
      };
      apiKeysStore.set(id, full);
      return full;
    },
    seedAsset(asset) {
      const id = asset.id ?? randomUUID();
      const full: Asset = {
        id,
        orgId: asset.orgId,
        publicId: asset.publicId,
        storageKey: asset.storageKey ?? `orgs/${asset.orgId}/orig/${id}`,
        status: asset.status ?? "pending",
        mimeType: asset.mimeType ?? null,
        bytes: asset.bytes ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        checksum: asset.checksum ?? null,
        metadata: asset.metadata ?? {},
        tags: asset.tags ?? [],
        createdAt: asset.createdAt ?? new Date(),
        deletedAt: asset.deletedAt ?? null,
      };
      assetsStore.set(id, full);
      return full;
    },
    getAsset(id) {
      return assetsStore.get(id);
    },
    seedUsageDaily(row) {
      const full: UsageDaily = {
        orgId: row.orgId,
        day: row.day,
        requests: row.requests ?? 0,
        transforms: row.transforms ?? 0,
        bandwidth: row.bandwidth ?? 0,
        storage: row.storage ?? 0,
      };
      usageDailyStore.set(`${full.orgId}|${full.day}`, full);
      return full;
    },
    getWebhooks() {
      return [...webhooksStore.values()];
    },
    getTransformPresets() {
      return [...transformPresetsStore.values()];
    },
    clear() {
      orgsStore.clear();
      apiKeysStore.clear();
      assetsStore.clear();
      usageDailyStore.clear();
      webhooksStore.clear();
      transformPresetsStore.clear();
    },
  };

  const query = {
    apiKeys: createRelationalQuery(apiKeysStore),
    assets: createRelationalQuery(assetsStore),
    usageDaily: createRelationalQuery(usageDailyStore),
  };

  const db = {
    query,
    insert(table: unknown) {
      if (table === assets) {
        return createInsertBuilder(assetsStore, {
          uniqueOn: ["orgId", "publicId"],
          defaults: {
            mimeType: null,
            bytes: null,
            width: null,
            height: null,
            checksum: null,
            metadata: {},
            tags: [],
            deletedAt: null,
          },
        });
      }
      if (table === apiKeys) return createInsertBuilder(apiKeysStore);
      if (table === orgs) return createInsertBuilder(orgsStore);
      if (table === webhooks) {
        return createInsertBuilder(webhooksStore, {
          defaults: { events: ["asset.ready", "asset.failed"] },
        });
      }
      if (table === transformPresets) {
        return createInsertBuilder(transformPresetsStore, { uniqueOn: ["orgId", "name"] });
      }
      throw new Error("fake db: unsupported insert table");
    },
    update(table: unknown) {
      if (table === assets) return createUpdateBuilder(assetsStore);
      if (table === apiKeys) return createUpdateBuilder(apiKeysStore);
      throw new Error("fake db: unsupported update table");
    },
  };

  return {
    db: db as unknown as DbClient["db"],
    close: async () => {},
    fake,
  };
}

export const fakeDbClient = createFakeDbClient();
