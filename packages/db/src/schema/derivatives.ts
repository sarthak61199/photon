import { bigint, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets";

export const derivatives = pgTable(
  "derivatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    transformKey: text("transform_key").notNull(),
    storageKey: text("storage_key").notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("derivatives_asset_id_transform_key_key").on(table.assetId, table.transformKey),
  ],
);

export type Derivative = typeof derivatives.$inferSelect;
export type NewDerivative = typeof derivatives.$inferInsert;
