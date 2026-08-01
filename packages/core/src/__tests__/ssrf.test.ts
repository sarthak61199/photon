import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { assertPublicHttpUrl, isPrivateAddress, SsrfError } = await import("../ssrf");

describe("isPrivateAddress", () => {
  it.each([
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["127.0.0.1", true],
    ["169.254.1.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["0.0.0.0", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["172.15.255.255", false],
    ["172.32.0.0", false],
  ])("classifies IPv4 %s as private=%s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  it.each([
    ["::1", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["2001:4860:4860::8888", false],
    ["::ffff:8.8.8.8", false],
  ])("classifies IPv6 %s as private=%s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  it("treats an unparseable literal as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("rejects a non-http(s) scheme", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(SsrfError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(SsrfError);
  });

  it("allows a public https URL that resolves to a public address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHttpUrl("https://example.com/image.jpg")).resolves.toBeUndefined();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertPublicHttpUrl("https://internal.example.com/x")).rejects.toThrow(SsrfError);
  });

  it("rejects when any resolved address is private, even if another is public", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(assertPublicHttpUrl("https://mixed.example.com/x")).rejects.toThrow(SsrfError);
  });

  it("checks literal IP hosts directly without a DNS lookup", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/admin")).rejects.toThrow(SsrfError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a literal public IP host without a DNS lookup", async () => {
    await expect(assertPublicHttpUrl("http://93.184.216.34/x")).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
