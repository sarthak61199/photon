import { createHmac } from "node:crypto";
import type { DbClient, Webhook } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh_1",
    orgId: "org_1",
    url: "https://93.184.216.34/hook",
    secret: "shh",
    events: ["asset.ready", "asset.failed"],
    ...overrides,
  };
}

function fakeDbWithWebhooks(webhooks: Webhook[]): DbClient {
  return {
    db: { query: { webhooks: { findMany: async () => webhooks } } },
    close: async () => {},
  } as unknown as DbClient;
}

const enqueueDeliverWebhook = vi.fn().mockResolvedValue(undefined);
vi.mock("../queue", () => ({ enqueueDeliverWebhook }));

let currentWebhook: Webhook | undefined;
const fakeDeliverDb: DbClient = {
  db: { query: { webhooks: { findFirst: async () => currentWebhook } } },
  close: async () => {},
} as unknown as DbClient;
vi.mock("../db", () => ({ getDbClient: () => fakeDeliverDb }));

const { enqueueWebhookEvent, deliverWebhookJob } = await import("../webhooks");

describe("enqueueWebhookEvent", () => {
  beforeEach(() => {
    enqueueDeliverWebhook.mockClear();
  });

  it("does nothing when no webhooks are registered", async () => {
    await enqueueWebhookEvent(fakeDbWithWebhooks([]), "org_1", "asset.ready", { assetId: "a1" });
    expect(enqueueDeliverWebhook).not.toHaveBeenCalled();
  });

  it("skips webhooks not subscribed to the event", async () => {
    const wh = webhook({ events: ["asset.failed"] });
    await enqueueWebhookEvent(fakeDbWithWebhooks([wh]), "org_1", "asset.ready", { assetId: "a1" });
    expect(enqueueDeliverWebhook).not.toHaveBeenCalled();
  });

  it("enqueues a delivery job per matching webhook", async () => {
    const wh = webhook();
    const payload = { assetId: "a1", status: "ready" };

    await enqueueWebhookEvent(fakeDbWithWebhooks([wh]), "org_1", "asset.ready", payload);

    expect(enqueueDeliverWebhook).toHaveBeenCalledTimes(1);
    expect(enqueueDeliverWebhook).toHaveBeenCalledWith({
      webhookId: wh.id,
      event: "asset.ready",
      payload,
    });
  });
});

describe("deliverWebhookJob", () => {
  beforeEach(() => {
    currentWebhook = webhook();
    vi.restoreAllMocks();
  });

  it("does nothing when the webhook no longer exists", async () => {
    currentWebhook = undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await deliverWebhookJob({ data: { webhookId: "missing", event: "asset.ready", payload: {} } });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a signed payload to the webhook", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const payload = { assetId: "a1", status: "ready" };

    await deliverWebhookJob({ data: { webhookId: "wh_1", event: "asset.ready", payload } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(currentWebhook?.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");

    const body = init.body as string;
    const expectedSignature = createHmac("sha256", currentWebhook?.secret ?? "")
      .update(body)
      .digest("hex");
    expect((init.headers as Record<string, string>)["x-photon-signature"]).toBe(expectedSignature);
    expect(JSON.parse(body)).toEqual({ event: "asset.ready", payload });
  });

  it("throws when the receiving endpoint returns a non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      deliverWebhookJob({ data: { webhookId: "wh_1", event: "asset.ready", payload: {} } }),
    ).rejects.toThrow();
  });

  it("refuses to deliver to a private address without calling fetch", async () => {
    currentWebhook = webhook({ url: "http://127.0.0.1/hook" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      deliverWebhookJob({ data: { webhookId: "wh_1", event: "asset.ready", payload: {} } }),
    ).rejects.toThrow(/private/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when the endpoint responds with a redirect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/evil" } }),
    );

    await expect(
      deliverWebhookJob({ data: { webhookId: "wh_1", event: "asset.ready", payload: {} } }),
    ).rejects.toThrow();
  });

  it("throws (does not swallow) when the network request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(
      deliverWebhookJob({ data: { webhookId: "wh_1", event: "asset.ready", payload: {} } }),
    ).rejects.toThrow("network down");
  });
});
