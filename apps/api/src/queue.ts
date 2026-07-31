import { PgBoss } from "pg-boss";
import { getConfig } from "./config";

const PROCESS_ASSET_QUEUE = "process-asset";

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function initBoss(): Promise<PgBoss> {
  const instance = new PgBoss(getConfig().databaseUrl);
  instance.on("error", (err) => console.error("pg-boss error", err));
  await instance.start();
  await instance.createQueue(PROCESS_ASSET_QUEUE);
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
