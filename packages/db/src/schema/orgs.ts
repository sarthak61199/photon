import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./_types";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  urlSignKey: bytea("url_sign_key").notNull(),
  requiresSignedUrls: boolean("requires_signed_urls").notNull().default(false),
  settings: jsonb("settings").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
