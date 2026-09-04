import { afterEach, describe, expect, it, vi } from "vitest";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { recordException } from "../recordException.js";

function fakeSpan() {
  return {
    recordException: vi.fn(),
    setStatus: vi.fn(),
  } as unknown as Span & {
    recordException: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordException", () => {
  it("records the exception and error status on the active span", () => {
    const span = fakeSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    const error = new Error("boom");
    recordException(error);

    expect(span.recordException).toHaveBeenCalledWith(error);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "boom",
    });
  });

  it("is a no-op when there is no active span", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);

    expect(() => recordException(new Error("boom"))).not.toThrow();
  });

  it("coerces a string into an Error", () => {
    const span = fakeSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    recordException("plain string failure");

    const recorded = span.recordException.mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe("plain string failure");
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "plain string failure",
    });
  });

  it("coerces a non-Error object into an Error via JSON", () => {
    const span = fakeSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    recordException({ code: 500, reason: "downstream" });

    const recorded = span.recordException.mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe('{"code":500,"reason":"downstream"}');
  });

  it("falls back to String() when the value is not JSON-serializable", () => {
    const span = fakeSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    recordException(circular);

    const recorded = span.recordException.mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe("[object Object]");
  });

  it("preserves the original Error instance rather than re-wrapping", () => {
    const span = fakeSpan();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    class CustomError extends Error {}
    const error = new CustomError("custom");
    recordException(error);

    expect(span.recordException.mock.calls[0][0]).toBe(error);
  });
});
