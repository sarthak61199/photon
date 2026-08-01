import type { Transform } from "@photon/core";
import { transformKey } from "@photon/core";

// Hono's router already collapses literal ".." segments that sit between real
// slashes before a route ever matches. The residual attack surface is an
// encoded slash (%2f) hiding a segment boundary from the router while still
// decoding to a literal ".." by the time `c.req.param()` hands us the value —
// e.g. "/acme/w_10/foo%2f..%2fbar.jpg" reaches this handler with a real ".."
// segment in the decoded public id. This guard runs on those decoded values,
// right before they're interpolated into S3 keys.
export class PathTraversalError extends Error {
  constructor(segment: string) {
    super(`Unsafe path segment: "${segment}"`);
    this.name = "PathTraversalError";
  }
}

function assertSafeSegments(value: string): void {
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new PathTraversalError(value);
    }
  }
}

export function assertSafeOrg(org: string): void {
  assertSafeSegments(org);
}

export function assertSafePublicId(publicId: string): void {
  assertSafeSegments(publicId);
}

// Built from the resolved org/asset IDs, not the raw URL segments — the URL's
// :org is a customer-facing slug and :path is the customer-facing public id,
// neither of which are the storage-key convention the API's upload flow uses
// (`orgs/{orgId}/orig/{assetId}`). Deriving keys from IDs keeps delivery and
// the API in permanent agreement instead of coincidentally matching.
export function derivativeKey(orgId: string, assetId: string, t: Transform, ext: string): string {
  return `orgs/${orgId}/deriv/${assetId}/${transformKey(t, ext)}`;
}
