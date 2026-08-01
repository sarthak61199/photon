import { createHmac } from "node:crypto";
import type { DbClient } from "@photon/db";
import { getDbClient } from "./db";
import { enqueueDeliverWebhook } from "./queue";

export async function enqueueWebhookEvent(
  db: DbClient,
  orgId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const rows = await db.db.query.webhooks.findMany({
    where: (w, { eq }) => eq(w.orgId, orgId),
  });
  const targets = rows.filter((row) => row.events.includes(event));

  await Promise.all(
    targets.map((webhook) => enqueueDeliverWebhook({ webhookId: webhook.id, event, payload })),
  );
}

export interface DeliverWebhookJob {
  data: { webhookId: string; event: string; payload: unknown };
}

// One delivery attempt per invocation — on failure this throws so pg-boss's
// queue-level retryLimit/retryBackoff (see ./queue.ts) actually retries it,
// instead of the previous inline-fetch approach that swallowed failures forever.
export async function deliverWebhookJob(job: DeliverWebhookJob): Promise<void> {
  const { webhookId, event, payload } = job.data;
  const { db } = getDbClient();

  const webhook = await db.query.webhooks.findFirst({
    where: (w, { eq }) => eq(w.id, webhookId),
  });
  if (!webhook) {
    console.warn(`worker: deliver-webhook skipped, webhook not found: ${webhookId}`);
    return;
  }

  const body = JSON.stringify({ event, payload });
  const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");

  const res = await fetch(webhook.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-photon-signature": signature },
    body,
  });

  if (!res.ok) {
    throw new Error(`webhook delivery to ${webhook.url} failed with status ${res.status}`);
  }
}
