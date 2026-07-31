export class BadTransformError extends Error {
  constructor(part: string) {
    super(`Invalid transform segment: "${part}"`);
    this.name = "BadTransformError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Invalid or missing signature") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
