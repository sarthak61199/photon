import { randomBytes, randomUUID } from "node:crypto";
import { orgs, schema } from "@photon/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getConfig } from "./config";
import { getDbClient } from "./db";

const { db } = getDbClient();
const config = getConfig();

// Matches packages/db/src/seed.ts's dev-org slug shape.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = randomUUID().slice(0, 8);
  return `${base || "org"}-${suffix}`;
}

export const auth = betterAuth({
  secret: config.betterAuthSecret,
  baseURL: config.betterAuthUrl,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  user: {
    additionalFields: {
      // required: false — these are never in the signup request body (input: false); the
      // databaseHooks.user.create.before hook below always fills them in before the insert.
      // `required: true` here would validate the *request body*, which never carries them.
      orgId: { type: "string", input: false, required: false },
      role: { type: "string", input: false, required: false, defaultValue: "member" },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  telemetry: {
    enabled: false,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const [org] = await db
            .insert(orgs)
            .values({
              slug: slugify(user.name),
              name: `${user.name}'s workspace`,
              urlSignKey: randomBytes(32),
            })
            .returning({ id: orgs.id });
          if (!org) throw new Error("failed to create org for new user");

          return {
            data: {
              ...user,
              orgId: org.id,
              role: "owner",
            },
          };
        },
      },
    },
  },
  plugins: [tanstackStartCookies()],
});
