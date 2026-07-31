import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageClient } from "../client";
import { ObjectNotFoundError } from "../errors";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    S3Client: vi.fn().mockImplementation(function S3ClientMock() {
      return { send: sendMock };
    }),
    HeadObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    PutObjectCommand: class extends FakeCommand {},
  };
});

const getSignedUrlMock = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

const createPresignedPostMock = vi.fn();

vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: (...args: unknown[]) => createPresignedPostMock(...args),
}));

const config = {
  endpoint: "http://localhost:9000",
  region: "auto",
  bucket: "photon-assets",
  accessKeyId: "test",
  secretAccessKey: "test",
  forcePathStyle: true,
};

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
  createPresignedPostMock.mockReset();
});

describe("head", () => {
  it("returns metadata when the object exists", async () => {
    sendMock.mockResolvedValueOnce({
      ContentType: "image/jpeg",
      ContentLength: 1234,
      ETag: '"abc"',
    });
    const storage = createStorageClient(config);

    const meta = await storage.head("orgs/acme/orig/1");

    expect(meta).toEqual({ contentType: "image/jpeg", contentLength: 1234, etag: '"abc"' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: "photon-assets", Key: "orgs/acme/orig/1" } }),
    );
  });

  it("returns null when the object does not exist", async () => {
    const err = new Error("not found");
    err.name = "NotFound";
    sendMock.mockRejectedValueOnce(err);
    const storage = createStorageClient(config);

    await expect(storage.head("missing")).resolves.toBeNull();
  });

  it("rethrows unrelated errors", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    const storage = createStorageClient(config);

    await expect(storage.head("x")).rejects.toThrow("boom");
  });
});

describe("get", () => {
  it("returns a stream and metadata when the object exists", async () => {
    const stream = Readable.from(["data"]);
    sendMock.mockResolvedValueOnce({
      Body: stream,
      ContentType: "image/png",
      ContentLength: 42,
      ETag: '"x"',
    });
    const storage = createStorageClient(config);

    const result = await storage.get("orgs/acme/orig/1");

    expect(result.stream).toBe(stream);
    expect(result.contentType).toBe("image/png");
    expect(result.contentLength).toBe(42);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: "photon-assets", Key: "orgs/acme/orig/1" } }),
    );
  });

  it("throws ObjectNotFoundError when the key is missing", async () => {
    const err = new Error("no key");
    err.name = "NoSuchKey";
    sendMock.mockRejectedValueOnce(err);
    const storage = createStorageClient(config);

    await expect(storage.get("missing")).rejects.toThrow(ObjectNotFoundError);
  });

  it("rethrows unrelated errors", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    const storage = createStorageClient(config);

    await expect(storage.get("x")).rejects.toThrow("boom");
  });
});

describe("put", () => {
  it("sends a PutObjectCommand with bucket, key, body and content type", async () => {
    sendMock.mockResolvedValueOnce({});
    const storage = createStorageClient(config);
    const body = Buffer.from("photon-bytes");

    await storage.put("orgs/acme/deriv/1/w_800.webp", body, { contentType: "image/webp" });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: "photon-assets",
          Key: "orgs/acme/deriv/1/w_800.webp",
          Body: body,
          ContentType: "image/webp",
        },
      }),
    );
  });
});

describe("presignPut", () => {
  it("calls getSignedUrl with a PutObjectCommand and the given expiry", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/put");
    const storage = createStorageClient(config);

    const url = await storage.presignPut("orgs/acme/orig/1", {
      contentType: "image/jpeg",
      expiresInSeconds: 300,
    });

    expect(url).toBe("https://signed.example/put");
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: { Bucket: "photon-assets", Key: "orgs/acme/orig/1", ContentType: "image/jpeg" },
      }),
      { expiresIn: 300 },
    );
  });

  it("defaults the expiry to 900 seconds", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/put");
    const storage = createStorageClient(config);

    await storage.presignPut("orgs/acme/orig/1", { contentType: "image/jpeg" });

    expect(getSignedUrlMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 900,
    });
  });
});

describe("presignPost", () => {
  it("calls createPresignedPost with bucket, key, content-type and a max-size condition", async () => {
    createPresignedPostMock.mockResolvedValueOnce({
      url: "https://signed.example/post",
      fields: { key: "orgs/acme/orig/1", "Content-Type": "image/jpeg" },
    });
    const storage = createStorageClient(config);

    const result = await storage.presignPost("orgs/acme/orig/1", {
      contentType: "image/jpeg",
      maxBytes: 1024,
      expiresInSeconds: 300,
    });

    expect(result).toEqual({
      url: "https://signed.example/post",
      fields: { key: "orgs/acme/orig/1", "Content-Type": "image/jpeg" },
    });
    expect(createPresignedPostMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: "photon-assets",
        Key: "orgs/acme/orig/1",
        Conditions: [
          ["content-length-range", 0, 1024],
          ["eq", "$Content-Type", "image/jpeg"],
        ],
        Fields: { "Content-Type": "image/jpeg" },
        Expires: 300,
      }),
    );
  });

  it("defaults the expiry to 900 seconds", async () => {
    createPresignedPostMock.mockResolvedValueOnce({
      url: "https://signed.example/post",
      fields: {},
    });
    const storage = createStorageClient(config);

    await storage.presignPost("orgs/acme/orig/1", { contentType: "image/jpeg", maxBytes: 1024 });

    expect(createPresignedPostMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ Expires: 900 }),
    );
  });
});
