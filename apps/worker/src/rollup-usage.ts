import { usageDaily, usageEvents } from "@photon/db";
import { lt, sql } from "drizzle-orm";
import { getDbClient } from "./db";

interface DailyTotals {
  orgId: string;
  day: string;
  requests: number;
  transforms: number;
  bandwidth: number;
}

export async function rollupUsage(): Promise<void> {
  const { db } = getDbClient();
  const cutoff = new Date();

  try {
    const dayExpr = sql<string>`date_trunc('day', ${usageEvents.occurredAt})::date`;

    const grouped = await db
      .select({
        orgId: usageEvents.orgId,
        day: dayExpr.as("day"),
        kind: usageEvents.kind,
        total: sql<string>`sum(${usageEvents.quantity})`.as("total"),
      })
      .from(usageEvents)
      .where(lt(usageEvents.occurredAt, cutoff))
      .groupBy(usageEvents.orgId, dayExpr, usageEvents.kind);

    if (grouped.length === 0) return;

    const byOrgDay = new Map<string, DailyTotals>();
    for (const row of grouped) {
      const key = `${row.orgId}|${row.day}`;
      const entry = byOrgDay.get(key) ?? {
        orgId: row.orgId,
        day: row.day,
        requests: 0,
        transforms: 0,
        bandwidth: 0,
      };
      const total = Number(row.total);
      if (row.kind === "request") entry.requests += total;
      else if (row.kind === "transform") entry.transforms += total;
      else if (row.kind === "bandwidth") entry.bandwidth += total;
      byOrgDay.set(key, entry);
    }

    await db
      .insert(usageDaily)
      .values([...byOrgDay.values()])
      .onConflictDoUpdate({
        target: [usageDaily.orgId, usageDaily.day],
        set: {
          requests: sql`${usageDaily.requests} + excluded.requests`,
          transforms: sql`${usageDaily.transforms} + excluded.transforms`,
          bandwidth: sql`${usageDaily.bandwidth} + excluded.bandwidth`,
        },
      });

    await db.delete(usageEvents).where(lt(usageEvents.occurredAt, cutoff));
  } catch (err) {
    console.error("worker: rollup-usage failed", err);
    throw err;
  }
}
