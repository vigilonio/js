// Error classes of the application's own: one with a constructor, one
// without.
export class RequestError extends Error {
  constructor(status) {
    super(`Request failed with status ${status}`);
    this.name = "RequestError";
    this.status = status;
  }
}

export class TimeoutError extends Error {}
