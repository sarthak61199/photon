import { PgBoss } from "pg-boss";
import { getConfig } from "./config";
import { type ProcessAssetJob, processAsset } from "./process-asset";

const PROCESS_ASSET_QUEUE = "process-asset"; // must match apps/api/src/queue.ts

async function main(): Promise<void> {
  const boss = new PgBoss(getConfig().databaseUrl);
  boss.on("error", (err: unknown) => console.error("pg-boss error", err));
  await boss.start();
  await boss.createQueue(PROCESS_ASSET_QUEUE);

  await boss.work(PROCESS_ASSET_QUEUE, { batchSize: 5 }, async (jobs: ProcessAssetJob[]) => {
    for (const job of jobs) {
      await processAsset(job);
    }
  });

  console.log(`worker: listening on "${PROCESS_ASSET_QUEUE}"`);
}

main().catch((err) => {
  console.error("worker: fatal", err);
  process.exit(1);
});
