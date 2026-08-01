export class MissingApiKeyError extends Error {
  constructor() {
    super("Missing API key");
    this.name = "MissingApiKeyError";
  }
}

export class InvalidApiKeyError extends Error {
  constructor() {
    super("Invalid or revoked API key");
    this.name = "InvalidApiKeyError";
  }
}

export class InsufficientScopeError extends Error {
  constructor(scope: string) {
    super(`API key is missing required scope: "${scope}"`);
    this.name = "InsufficientScopeError";
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitedError";
  }
}

export class AssetNotFoundError extends Error {
  constructor(publicId: string) {
    super(`Asset not found: "${publicId}"`);
    this.name = "AssetNotFoundError";
  }
}

export class DuplicatePublicIdError extends Error {
  constructor(publicId: string) {
    super(`An asset with publicId "${publicId}" already exists`);
    this.name = "DuplicatePublicIdError";
  }
}

export class DuplicatePresetNameError extends Error {
  constructor(name: string) {
    super(`A preset named "${name}" already exists`);
    this.name = "DuplicatePresetNameError";
  }
}

export class BadCursorError extends Error {
  constructor(cursor: string) {
    super(`Invalid pagination cursor: "${cursor}"`);
    this.name = "BadCursorError";
  }
}

export class InvalidUsageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsageRangeError";
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && err.code === "23505") return true;
  if ("cause" in err) return isUniqueViolation(err.cause);
  return false;
}
