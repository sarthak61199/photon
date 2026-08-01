import { PgBoss } from "pg-boss";
import { getConfig } from "./config";
import { type FetchUrlJob, fetchUrl } from "./fetch-url";
import { type IngestUsageEventsJob, ingestUsageEvents } from "./ingest-usage-events";
import { type ProcessAssetJob, processAsset } from "./process-asset";
import { type PurgeAssetJob, purgeAsset } from "./purge-asset";
import { rollupUsage } from "./rollup-usage";
import { type DeliverWebhookJob, deliverWebhookJob } from "./webhooks";

const PROCESS_ASSET_QUEUE = "process-asset"; // must match apps/api/src/queue.ts
const INGEST_USAGE_EVENTS_QUEUE = "ingest-usage-events"; // must match apps/delivery/src/queue.ts
const DELIVER_WEBHOOK_QUEUE = "deliver-webhook"; // must match apps/worker/src/queue.ts
const DELIVER_WEBHOOK_RETRY_LIMIT = 8;
const FETCH_URL_QUEUE = "fetch-url"; // must match apps/api/src/queue.ts
const PURGE_ASSET_QUEUE = "purge-asset"; // must match apps/api/src/queue.ts
// "storage-snapshot" is a distinct, not-yet-built nightly queue (per-org storage bytes) —
// reserved name, don't reuse for anything else.
const ROLLUP_USAGE_QUEUE = "rollup-usage";

async function main(): Promise<void> {
  const boss = new PgBoss(getConfig().databaseUrl);
  boss.on("error", (err: unknown) => console.error("pg-boss error", err));
  await boss.start();
  await boss.createQueue(PROCESS_ASSET_QUEUE);
  await boss.createQueue(INGEST_USAGE_EVENTS_QUEUE);
  await boss.createQueue(DELIVER_WEBHOOK_QUEUE, {
    retryLimit: DELIVER_WEBHOOK_RETRY_LIMIT,
    retryBackoff: true,
  });
  await boss.createQueue(FETCH_URL_QUEUE);
  await boss.createQueue(PURGE_ASSET_QUEUE);
  await boss.createQueue(ROLLUP_USAGE_QUEUE);
  await boss.schedule(ROLLUP_USAGE_QUEUE, "*/5 * * * *");

  await boss.work(PROCESS_ASSET_QUEUE, { batchSize: 5 }, async (jobs: ProcessAssetJob[]) => {
    for (const job of jobs) {
      await processAsset(job);
    }
  });

  await boss.work(
    INGEST_USAGE_EVENTS_QUEUE,
    { batchSize: 10 },
    async (jobs: IngestUsageEventsJob[]) => {
      for (const job of jobs) {
        await ingestUsageEvents(job);
      }
    },
  );

  await boss.work(DELIVER_WEBHOOK_QUEUE, { batchSize: 10 }, async (jobs: DeliverWebhookJob[]) => {
    for (const job of jobs) {
      await deliverWebhookJob(job);
    }
  });

  await boss.work(FETCH_URL_QUEUE, { batchSize: 5 }, async (jobs: FetchUrlJob[]) => {
    for (const job of jobs) {
      await fetchUrl(job);
    }
  });

  await boss.work(PURGE_ASSET_QUEUE, { batchSize: 5 }, async (jobs: PurgeAssetJob[]) => {
    for (const job of jobs) {
      await purgeAsset(job);
    }
  });

  await boss.work(ROLLUP_USAGE_QUEUE, async () => {
    await rollupUsage();
  });

  console.log(
    `worker: listening on "${PROCESS_ASSET_QUEUE}", "${INGEST_USAGE_EVENTS_QUEUE}", "${DELIVER_WEBHOOK_QUEUE}", "${FETCH_URL_QUEUE}", "${PURGE_ASSET_QUEUE}", "${ROLLUP_USAGE_QUEUE}"`,
  );
}

main().catch((err) => {
  console.error("worker: fatal", err);
  process.exit(1);
});
