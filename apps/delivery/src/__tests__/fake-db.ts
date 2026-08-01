import { randomUUID } from "node:crypto";
import type { Asset, DbClient, NewAsset, NewOrg, Org } from "@photon/db";

type Row = Record<string, unknown>;
type Predicate<T> = (row: T) => boolean;

// See apps/api/src/__tests__/fake-db.ts for the fuller version of this
// pattern (findMany, insert, update). Delivery only ever reads a single org
// and a single asset per request, so this fake only needs findFirst.
function makeFieldProxy<T extends Row>(): T {
  return new Proxy({}, { get: (_target, prop) => prop }) as T;
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
    isNull:
      (field: keyof T): Predicate<T> =>
      (row) =>
        row[field] == null,
  };
}

interface FindConfig<T extends Row> {
  where?: (fields: T, ops: ReturnType<typeof makeWhereOperators<T>>) => Predicate<T> | undefined;
}

function createRelationalQuery<T extends Row>(store: Map<string, T>) {
  return {
    async findFirst(config?: FindConfig<T>): Promise<T | undefined> {
      const rows = [...store.values()];
      const predicate = config?.where?.(makeFieldProxy<T>(), makeWhereOperators<T>());
      return predicate ? rows.find(predicate) : rows[0];
    },
  };
}

export interface FakeDb {
  seedOrg(org: Partial<NewOrg> & { id?: string; slug: string }): Org;
  seedAsset(asset: Partial<NewAsset> & { orgId: string; publicId: string }): Asset;
  clear(): void;
}

export function createFakeDbClient(): DbClient & { fake: FakeDb } {
  const orgsStore = new Map<string, Org>();
  const assetsStore = new Map<string, Asset>();

  const fake: FakeDb = {
    seedOrg(org) {
      const id = org.id ?? randomUUID();
      const full: Org = {
        id,
        slug: org.slug,
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
    seedAsset(asset) {
      const id = asset.id ?? randomUUID();
      const full: Asset = {
        id,
        orgId: asset.orgId,
        publicId: asset.publicId,
        storageKey: asset.storageKey ?? `orgs/${asset.orgId}/orig/${id}`,
        status: asset.status ?? "ready",
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
    clear() {
      orgsStore.clear();
      assetsStore.clear();
    },
  };

  const query = {
    orgs: createRelationalQuery(orgsStore),
    assets: createRelationalQuery(assetsStore),
  };

  return {
    db: { query } as unknown as DbClient["db"],
    close: async () => {},
    fake,
  };
}

export const fakeDbClient = createFakeDbClient();
