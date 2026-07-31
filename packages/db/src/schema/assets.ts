import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    publicId: text("public_id").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("pending"),
    mimeType: text("mime_type"),
    bytes: bigint("bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    tags: text("tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("assets_org_id_public_id_key").on(table.orgId, table.publicId),
    index("assets_org_id_created_at_idx").on(table.orgId, table.createdAt.desc()),
    index("assets_tags_gin_idx").using("gin", table.tags),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
