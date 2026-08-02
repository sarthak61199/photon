import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext } from "./_types";
import { orgs } from "./orgs";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  email: citext("email").notNull().unique(),
  role: text("role").notNull().default("member"),
  // Below: required by better-auth's core user schema (apps/dashboard/src/server/auth.ts).
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
