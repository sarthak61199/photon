import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "./errors";

export function sign(path: string, key: Buffer): string {
  return createHmac("sha256", key).update(path).digest("base64url").slice(0, 16);
}

export function verifySignature(path: string, key: Buffer): void {
  const m = path.match(/^\/[^/]+\/s_([^,/]+)[,/](.+)$/);
  if (!m) throw new UnauthorizedError();
  const [, sig, rest] = m;
  const expected = sign(rest ?? "", key);
  const a = Buffer.from(sig ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();
}
