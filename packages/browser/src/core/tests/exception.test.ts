import { describe, expect, it } from "vitest";
import { limitException, toException } from "../exception";

describe("toException", () => {
  it("keeps an Error's name, message, and raw stack", () => {
    const error = new TypeError("boom");
    const exception = toException(error, "manual", true);
    expect(exception).toMatchObject({
      type: "TypeError",
      message: "boom",
      stack: error.stack,
      mechanism: "manual",
      handled: true,
    });
    expect(exception.cause).toBeUndefined();
  });

  it("normalises non-Error throwables like @vigilon/node", () => {
    expect(toException("plain string", "onerror", false)).toMatchObject({
      type: "Error",
      message: "plain string",
      stack: null,
    });
    expect(toException({ code: 42 }, "unhandledrejection", false).message).toBe('{"code":42}');
    expect(toException(undefined, "unhandledrejection", false).message).toBe("undefined");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toException(circular, "manual", true).message).toBe("[object Object]");
  });

  it("captures the cause chain up to depth 5 and stops on a cycle", () => {
    let error: Error = new Error("root");
    for (let i = 0; i < 7; i += 1) {
      error = new Error(`level ${i}`, { cause: error });
    }
    expect(toException(error, "manual", true).cause).toHaveLength(5);

    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(toException(b, "manual", true).cause?.map((c) => c.message)).toEqual(["a"]);

    expect(toException(new Error("x", { cause: "why" }), "manual", true).cause).toEqual([
      { type: "Error", message: "why", stack: null },
    ]);
  });
});

describe("limitException", () => {
  it("caps fields and scrubs stacks, including in causes", () => {
    const limited = limitException({
      type: "T".repeat(300),
      message: "m".repeat(9000),
      stack: "Error\n    at f (https://app.example.com/a.js?secret=1:1:2)",
      mechanism: "manual",
      handled: true,
      cause: [{ type: "E", message: "c", stack: "at g (https://x.example.com/b.js#t:3:4)" }],
    });
    expect(limited.type).toHaveLength(256);
    expect(limited.message).toHaveLength(8 * 1024);
    expect(limited.stack).toBe("Error\n    at f (https://app.example.com/a.js:1:2)");
    expect(limited.cause?.[0]?.stack).toBe("at g (https://x.example.com/b.js:3:4)");
  });
});
