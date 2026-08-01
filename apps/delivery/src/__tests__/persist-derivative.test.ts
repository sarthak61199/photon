import type { DbClient } from "@photon/db";
import type { StorageClient } from "@photon/storage";
import { describe, expect, it, vi } from "vitest";
import { persistDerivative } from "../persist-derivative";

function createStorageStub(putImpl: StorageClient["put"]): StorageClient {
  return {
    head: vi.fn(),
    get: vi.fn(),
    put: putImpl,
    delete: vi.fn(),
    presignPut: vi.fn(),
    presignPost: vi.fn(),
  };
}

function createDbStub(insertValues: (row: unknown) => void): DbClient {
  return {
    db: {
      insert: () => ({
        values: (row: unknown) => {
          insertValues(row);
          return { onConflictDoNothing: async () => {} };
        },
      }),
    },
    close: async () => {},
  } as unknown as DbClient;
}

const meta = { assetId: "asset-1", transformKey: "w_10.jpg" };

describe("persistDerivative", () => {
  it("calls storage.put with the key, body, and content type", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const storage = createStorageStub(put);
    const db = createDbStub(() => {});
    const body = Buffer.from("bytes");

    persistDerivative(storage, db, "orgs/acme/deriv/x/w_10.jpg", body, "image/jpeg", meta);
    await vi.waitFor(() => expect(put).toHaveBeenCalled());

    expect(put).toHaveBeenCalledWith("orgs/acme/deriv/x/w_10.jpg", body, {
      contentType: "image/jpeg",
    });
  });

  it("registers a derivatives row after the storage write succeeds", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const storage = createStorageStub(put);
    const insertValues = vi.fn();
    const db = createDbStub(insertValues);
    const body = Buffer.from("bytes");

    persistDerivative(storage, db, "orgs/acme/deriv/x/w_10.jpg", body, "image/jpeg", meta);
    await vi.waitFor(() => expect(insertValues).toHaveBeenCalled());

    expect(insertValues).toHaveBeenCalledWith({
      assetId: meta.assetId,
      transformKey: meta.transformKey,
      storageKey: "orgs/acme/deriv/x/w_10.jpg",
      bytes: body.length,
    });
  });

  it("does not throw or reject when storage.put fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const put = vi.fn().mockRejectedValue(new Error("s3 down"));
    const storage = createStorageStub(put);
    const db = createDbStub(() => {});

    expect(() =>
      persistDerivative(storage, db, "key", Buffer.from("x"), "image/jpeg", meta),
    ).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    consoleError.mockRestore();
  });

  it("does not throw or reject when the derivatives insert fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const put = vi.fn().mockResolvedValue(undefined);
    const storage = createStorageStub(put);
    const db = {
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: async () => {
              throw new Error("db down");
            },
          }),
        }),
      },
      close: async () => {},
    } as unknown as DbClient;

    expect(() =>
      persistDerivative(storage, db, "key", Buffer.from("x"), "image/jpeg", meta),
    ).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    consoleError.mockRestore();
  });
});
