export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class ForbiddenError extends Error {
  constructor(message = "You can't do that in this project") {
    super(message);
    this.name = "ForbiddenError";
  }
}
