import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === undefined || b === undefined || parts.length !== 4) return true;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPrivateIPv4(mapped) : false;
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable literal address — treat as unsafe
}

// Resolves the hostname and rejects private/loopback/link-local targets and
// non-http(s) schemes, per the design doc's SSRF checklist item. Callers that
// follow redirects manually (fetch-from-url ingestion) must re-run this
// against each redirect target — this only validates the URL passed in.
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: "${rawUrl}"`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Unsupported URL scheme: "${url.protocol}"`);
  }

  const hostname = url.hostname;
  const addresses =
    isIP(hostname) !== 0
      ? [hostname]
      : (await lookup(hostname, { all: true })).map((a) => a.address);

  if (addresses.length === 0) {
    throw new SsrfError(`Could not resolve host: "${hostname}"`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfError(`Refusing to fetch a private/internal address: "${address}"`);
    }
  }
}
