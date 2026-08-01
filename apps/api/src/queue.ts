import { PgBoss } from "pg-boss";
import { getConfig } from "./config";

const PROCESS_ASSET_QUEUE = "process-asset";
const FETCH_URL_QUEUE = "fetch-url"; // must match apps/worker/src/index.ts
const PURGE_ASSET_QUEUE = "purge-asset"; // must match apps/worker/src/index.ts

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function initBoss(): Promise<PgBoss> {
  const instance = new PgBoss(getConfig().databaseUrl);
  instance.on("error", (err) => console.error("pg-boss error", err));
  await instance.start();
  await instance.createQueue(PROCESS_ASSET_QUEUE);
  await instance.createQueue(FETCH_URL_QUEUE);
  await instance.createQueue(PURGE_ASSET_QUEUE);
  boss = instance;
  return instance;
}

export function getQueue(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= initBoss();
  return starting;
}

export async function enqueueProcessAsset(assetId: string): Promise<void> {
  const q = await getQueue();
  await q.send(PROCESS_ASSET_QUEUE, { assetId });
}

export async function enqueueFetchUrl(assetId: string, url: string): Promise<void> {
  const q = await getQueue();
  await q.send(FETCH_URL_QUEUE, { assetId, url });
}

export async function enqueuePurgeAsset(assetId: string): Promise<void> {
  const q = await getQueue();
  await q.send(PURGE_ASSET_QUEUE, { assetId });
}
