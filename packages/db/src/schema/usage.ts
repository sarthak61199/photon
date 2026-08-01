import {
  bigint,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The design doc specifies `PARTITION BY RANGE (occurred_at)` with monthly
// partitions. drizzle-kit can't express PARTITION BY, and a partitioned table
// with no partition-maintenance job would start rejecting inserts once the
// bootstrap partitions are exhausted — worse than a plain table for now.
// Deferred until apps/worker has a job to pre-create future partitions.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity(),
    orgId: uuid("org_id").notNull(),
    kind: text("kind").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_occurred_at_idx").on(table.occurredAt)],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    orgId: uuid("org_id").notNull(),
    day: date("day").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    transforms: bigint("transforms", { mode: "number" }).notNull().default(0),
    bandwidth: bigint("bandwidth", { mode: "number" }).notNull().default(0),
    storage: bigint("storage", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.day] })],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type UsageDaily = typeof usageDaily.$inferSelect;
export type NewUsageDaily = typeof usageDaily.$inferInsert;
