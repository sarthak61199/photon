import { createHmac } from "node:crypto";
import type { DbClient, Webhook } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverEvent } from "../webhooks";

function fakeDb(webhooks: Webhook[]): DbClient {
  return {
    db: {
      query: {
        webhooks: {
          findMany: async () => webhooks,
        },
      },
    },
    close: async () => {},
  } as unknown as DbClient;
}

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh_1",
    orgId: "org_1",
    url: "https://example.com/hook",
    secret: "shh",
    events: ["asset.ready", "asset.failed"],
    ...overrides,
  };
}

describe("deliverEvent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no webhooks are registered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await deliverEvent(fakeDb([]), "org_1", "asset.ready", { assetId: "a1" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips webhooks not subscribed to the event", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const wh = webhook({ events: ["asset.failed"] });
    await deliverEvent(fakeDb([wh]), "org_1", "asset.ready", { assetId: "a1" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a signed payload to matching webhooks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const wh = webhook();
    const payload = { assetId: "a1", status: "ready" };

    await deliverEvent(fakeDb([wh]), "org_1", "asset.ready", payload);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(wh.url);
    expect(init.method).toBe("POST");

    const body = init.body as string;
    const expectedSignature = createHmac("sha256", wh.secret).update(body).digest("hex");
    expect((init.headers as Record<string, string>)["x-photon-signature"]).toBe(expectedSignature);
    expect(JSON.parse(body)).toEqual({ event: "asset.ready", payload });
  });

  it("does not throw when a webhook delivery fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      deliverEvent(fakeDb([webhook()]), "org_1", "asset.ready", {}),
    ).resolves.toBeUndefined();
  });
});
