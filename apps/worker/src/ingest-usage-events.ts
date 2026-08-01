import { usageEvents } from "@photon/db";
import { getDbClient } from "./db";

export interface IngestUsageEventsJob {
  data: {
    events: Array<{ orgId: string; kind: string; quantity: number; occurredAt: string }>;
  };
}

export async function ingestUsageEvents(job: IngestUsageEventsJob): Promise<void> {
  const { db } = getDbClient();

  try {
    await db.insert(usageEvents).values(
      job.data.events.map((e) => ({
        orgId: e.orgId,
        kind: e.kind,
        quantity: e.quantity,
        occurredAt: new Date(e.occurredAt),
      })),
    );
  } catch (err) {
    console.error("worker: ingest-usage-events failed", err);
    throw err;
  }
}
