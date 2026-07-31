import type { StorageClient } from "@img/storage";
import { describe, expect, it, vi } from "vitest";
import { persistDerivative } from "../persist-derivative";

function createStorageStub(putImpl: StorageClient["put"]): StorageClient {
  return {
    head: vi.fn(),
    get: vi.fn(),
    put: putImpl,
    presignPut: vi.fn(),
  };
}

describe("persistDerivative", () => {
  it("calls storage.put with the key, body, and content type", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const storage = createStorageStub(put);
    const body = Buffer.from("bytes");

    persistDerivative(storage, "orgs/acme/deriv/x/w_10.jpg", body, "image/jpeg");
    await vi.waitFor(() => expect(put).toHaveBeenCalled());

    expect(put).toHaveBeenCalledWith("orgs/acme/deriv/x/w_10.jpg", body, {
      contentType: "image/jpeg",
    });
  });

  it("does not throw or reject when storage.put fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const put = vi.fn().mockRejectedValue(new Error("s3 down"));
    const storage = createStorageStub(put);

    expect(() => persistDerivative(storage, "key", Buffer.from("x"), "image/jpeg")).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    consoleError.mockRestore();
  });
});
