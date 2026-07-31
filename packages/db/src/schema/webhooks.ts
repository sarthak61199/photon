import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull().default(["asset.ready", "asset.failed"]),
});

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
