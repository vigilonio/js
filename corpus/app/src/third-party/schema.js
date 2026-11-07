// A stand-in for a validation library. The corpus builds ignore-list this
// directory in their source maps, as bundlers do for dependencies, so its
// frames are not the application's own and the frame nearest the throw that
// is the application's is the call into it.
export class ValidationError extends Error {
  constructor(missing) {
    super(`Invalid response: ${missing.join(", ")} missing`);
    this.name = "ValidationError";
  }
}

export function object(shape) {
  return {
    parse(value) {
      const missing = shape.filter((key) => value?.[key] === undefined);
      if (missing.length > 0) {
        throw new ValidationError(missing);
      }
      return value;
    },
  };
}
