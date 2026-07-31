export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: "${key}"`);
    this.name = "ObjectNotFoundError";
  }
}
