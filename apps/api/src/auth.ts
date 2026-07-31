import { createHash } from "node:crypto";
import { apiKeys } from "@img/db";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDbClient } from "./db";
import { InsufficientScopeError, InvalidApiKeyError, MissingApiKeyError } from "./errors";

export interface AuthVariables {
  orgId: string;
  scopes: string[];
}

export const apiKeyAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header("authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!key) throw new MissingApiKeyError();

  const hash = createHash("sha256").update(key).digest("hex");
  const { db } = getDbClient();
  const row = await db.query.apiKeys.findFirst({
    where: (k, { eq, isNull, and }) => and(eq(k.keyHash, hash), isNull(k.revokedAt)),
  });
  if (!row) throw new InvalidApiKeyError();

  c.set("orgId", row.orgId);
  c.set("scopes", row.scopes);

  // Fire-and-forget — never block or fail the request on this.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err: unknown) => console.error("failed to update api key lastUsedAt", err));

  await next();
});

export function requireScope(scope: string) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const scopes = c.get("scopes");
    if (!scopes.includes(scope)) throw new InsufficientScopeError(scope);
    await next();
  });
}
