import { beforeEach, describe, expect, it, vi } from "vitest";

const endMock = vi.fn();
const postgresMock = vi.fn((_url: string, _opts?: { max?: number }) => ({ end: endMock }));

vi.mock("postgres", () => ({
  default: postgresMock,
}));

const drizzleMock = vi.fn((_client: unknown, _opts?: unknown) => ({}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: drizzleMock,
}));

const { createDbClient } = await import("../client");

beforeEach(() => {
  postgresMock.mockClear();
  drizzleMock.mockClear();
  endMock.mockClear();
});

describe("createDbClient", () => {
  it("creates a postgres client with the given url and a default pool size", () => {
    createDbClient({ url: "postgres://test" });

    expect(postgresMock).toHaveBeenCalledWith("postgres://test", { max: 10 });
  });

  it("respects an explicit max pool size", () => {
    createDbClient({ url: "postgres://test", max: 5 });

    expect(postgresMock).toHaveBeenCalledWith("postgres://test", { max: 5 });
  });

  it("wires drizzle up with the underlying client and the schema", () => {
    createDbClient({ url: "postgres://test" });

    expect(drizzleMock).toHaveBeenCalledWith(
      { end: endMock },
      expect.objectContaining({ schema: expect.anything() }),
    );
  });

  it("close() delegates to the underlying client's end()", async () => {
    const client = createDbClient({ url: "postgres://test" });

    await client.close();

    expect(endMock).toHaveBeenCalled();
  });
});
