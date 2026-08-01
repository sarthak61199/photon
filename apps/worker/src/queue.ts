import { PgBoss } from "pg-boss";
import { getConfig } from "./config";

const DELIVER_WEBHOOK_QUEUE = "deliver-webhook"; // must match apps/worker/src/index.ts
const RETRY_LIMIT = 8;

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function initBoss(): Promise<PgBoss> {
  const instance = new PgBoss(getConfig().databaseUrl);
  instance.on("error", (err) => console.error("pg-boss error", err));
  await instance.start();
  await instance.createQueue(DELIVER_WEBHOOK_QUEUE, {
    retryLimit: RETRY_LIMIT,
    retryBackoff: true,
  });
  boss = instance;
  return instance;
}

export function getQueue(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= initBoss();
  return starting;
}

export interface DeliverWebhookPayload {
  webhookId: string;
  event: string;
  payload: unknown;
}

export async function enqueueDeliverWebhook(data: DeliverWebhookPayload): Promise<void> {
  const q = await getQueue();
  await q.send(DELIVER_WEBHOOK_QUEUE, data);
}
