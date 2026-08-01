import { createHmac } from "node:crypto";
import type { DbClient } from "@photon/db";

export async function deliverEvent(
  db: DbClient,
  orgId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const rows = await db.db.query.webhooks.findMany({
    where: (w, { eq }) => eq(w.orgId, orgId),
  });
  const targets = rows.filter((row) => row.events.includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({ event, payload });

  await Promise.all(
    targets.map(async (webhook) => {
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      try {
        await fetch(webhook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-photon-signature": signature,
          },
          body,
        });
      } catch (err) {
        console.error(`worker: failed to deliver webhook ${webhook.id} for ${event}`, err);
      }
    }),
  );
}
