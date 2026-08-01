import { PgBoss } from "pg-boss";
import { getConfig } from "./config";
import type { UsageEventRow } from "./usage";

const INGEST_USAGE_EVENTS_QUEUE = "ingest-usage-events"; // must match apps/worker/src/index.ts

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function initBoss(): Promise<PgBoss> {
  const instance = new PgBoss(getConfig().databaseUrl);
  instance.on("error", (err) => console.error("pg-boss error", err));
  await instance.start();
  await instance.createQueue(INGEST_USAGE_EVENTS_QUEUE);
  boss = instance;
  return instance;
}

export function getQueue(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= initBoss();
  return starting;
}

export async function enqueueUsageEvents(events: UsageEventRow[]): Promise<void> {
  const q = await getQueue();
  await q.send(INGEST_USAGE_EVENTS_QUEUE, {
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
  });
}
