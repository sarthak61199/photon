import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth";
import { getDbClient } from "./db";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  return auth.api.getSession({ headers });
});

export const requireSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("unauthorized");
  return session;
});

export const getOrgForUser = createServerFn({ method: "GET" })
  .validator((orgId: string) => orgId)
  .handler(async ({ data: orgId }) => {
    const { db } = getDbClient();
    const org = await db.query.orgs.findFirst({
      where: (o, { eq }) => eq(o.id, orgId),
      columns: {
        id: true,
        slug: true,
        name: true,
        plan: true,
        requiresSignedUrls: true,
        createdAt: true,
      },
    });
    if (!org) throw new Error("org not found");
    return org;
  });
