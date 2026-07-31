import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext } from "./_types";
import { orgs } from "./orgs";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  email: citext("email").notNull().unique(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
