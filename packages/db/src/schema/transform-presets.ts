import { jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

export const transformPresets = pgTable(
  "transform_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    params: jsonb("params").notNull().$type<Record<string, unknown>>(),
  },
  (table) => [unique("transform_presets_org_id_name_key").on(table.orgId, table.name)],
);

export type TransformPreset = typeof transformPresets.$inferSelect;
export type NewTransformPreset = typeof transformPresets.$inferInsert;
