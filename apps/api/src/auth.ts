import { createHash } from "node:crypto";
import { apiKeys } from "@photon/db";
import { TokenBucket } from "@photon/utils";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDbClient } from "./db";
import {
  InsufficientScopeError,
  InvalidApiKeyError,
  MissingApiKeyError,
  RateLimitedError,
} from "./errors";

export interface AuthVariables {
  orgId: string;
  scopes: string[];
}

// Per-org, in-process token bucket — same MVP-simplicity tradeoff as
// apps/delivery's (see its app.ts): fine for a single instance, would need a
// shared (Redis/PG) backing store once the API runs on more than one.
const RATE_LIMIT_CAPACITY = 100;
const RATE_LIMIT_REFILL_PER_SECOND = 20;

function createRateLimiter(): TokenBucket {
  return new TokenBucket({
    capacity: RATE_LIMIT_CAPACITY,
    refillPerSecond: RATE_LIMIT_REFILL_PER_SECOND,
  });
}

let rateLimiter = createRateLimiter();

// Test-only.
export function resetRateLimiter(): void {
  rateLimiter = createRateLimiter();
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

  if (!rateLimiter.tryConsume(row.orgId)) throw new RateLimitedError();

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
