import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDbClient } from "./fake-db";

const fakeDb = createFakeDbClient();
vi.mock("../db", () => ({ getDbClient: () => fakeDb }));

const { resolvePreset, resetPresetCache } = await import("../resolve-preset");
const { PresetNotFoundError } = await import("../errors");

beforeEach(() => {
  fakeDb.fake.clear();
  resetPresetCache();
});

describe("resolvePreset", () => {
  it("resolves and validates a preset's params through TransformSchema", async () => {
    const org = fakeDb.fake.seedOrg({ slug: "acme" });
    fakeDb.fake.seedPreset({
      orgId: org.id,
      name: "thumbnail",
      params: { w: 300, h: 300, c: "fill" },
    });

    const transform = await resolvePreset(org.id, "thumbnail");

    expect(transform).toMatchObject({ w: 300, h: 300, c: "fill", f: "auto", dpr: 1 });
  });

  it("throws PresetNotFoundError when no preset matches", async () => {
    const org = fakeDb.fake.seedOrg({ slug: "acme" });
    await expect(resolvePreset(org.id, "missing")).rejects.toThrow(PresetNotFoundError);
  });

  it("does not leak a preset across orgs with the same name", async () => {
    const mine = fakeDb.fake.seedOrg({ slug: "mine" });
    const other = fakeDb.fake.seedOrg({ slug: "other" });
    fakeDb.fake.seedPreset({ orgId: other.id, name: "thumbnail", params: { w: 100 } });

    await expect(resolvePreset(mine.id, "thumbnail")).rejects.toThrow(PresetNotFoundError);
  });

  it("caches the resolved preset within the TTL", async () => {
    const org = fakeDb.fake.seedOrg({ slug: "acme" });
    fakeDb.fake.seedPreset({ orgId: org.id, name: "thumbnail", params: { w: 300 } });
    const findFirstSpy = vi.spyOn(fakeDb.db.query.transformPresets, "findFirst");

    await resolvePreset(org.id, "thumbnail");
    await resolvePreset(org.id, "thumbnail");

    expect(findFirstSpy).toHaveBeenCalledTimes(1);
  });
});
