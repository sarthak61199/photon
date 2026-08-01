export class OrgNotFoundError extends Error {
  constructor(slug: string) {
    super(`Org not found: "${slug}"`);
    this.name = "OrgNotFoundError";
  }
}

export class AssetNotFoundError extends Error {
  constructor(publicId: string) {
    super(`Asset not found: "${publicId}"`);
    this.name = "AssetNotFoundError";
  }
}

export class AssetNotReadyError extends Error {
  constructor(publicId: string, status: string) {
    super(`Asset "${publicId}" is not ready (status: "${status}")`);
    this.name = "AssetNotReadyError";
  }
}

export class PresetNotFoundError extends Error {
  constructor(name: string) {
    super(`Preset not found: "${name}"`);
    this.name = "PresetNotFoundError";
  }
}
