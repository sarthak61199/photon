import { assets, usageDaily } from "@photon/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDbClient } from "./db";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// A point-in-time snapshot, not a delta like rollup-usage — re-running this
// on the same day overwrites today's storage figure rather than adding to it.
export async function storageSnapshot(): Promise<void> {
  const { db } = getDbClient();
  const day = today();

  try {
    const grouped = await db
      .select({
        orgId: assets.orgId,
        totalBytes: sql<string>`sum(${assets.bytes})`.as("totalBytes"),
      })
      .from(assets)
      .where(and(eq(assets.status, "ready"), isNull(assets.deletedAt)))
      .groupBy(assets.orgId);

    if (grouped.length === 0) return;

    await db
      .insert(usageDaily)
      .values(grouped.map((row) => ({ orgId: row.orgId, day, storage: Number(row.totalBytes) })))
      .onConflictDoUpdate({
        target: [usageDaily.orgId, usageDaily.day],
        set: { storage: sql`excluded.storage` },
      });
  } catch (err) {
    console.error("worker: storage-snapshot failed", err);
    throw err;
  }
}
