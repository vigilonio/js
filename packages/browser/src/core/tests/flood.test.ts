import { describe, expect, it } from "vitest";
import type { BrowserEvent } from "../envelope";
import { FloodGuard } from "../flood";

function event(message: string): BrowserEvent {
  return {
    type: "exception",
    eventId: "00000000-0000-4000-8000-000000000000",
    timestamp: "2026-10-26T00:00:00.000Z",
    exception: { type: "Error", message, stack: "Error\n    at loop (a.js:1:1)", mechanism: "onerror", handled: false },
    page: { url: "https://app.example.com/" },
  };
}

describe("FloodGuard", () => {
  it("admits the same error once per window", () => {
    const guard = new FloodGuard(100, 60_000);
    expect(guard.admit(event("tick"), 0)).toBe(true);
    expect(guard.admit(event("tick"), 59_999)).toBe(false);
    expect(guard.admit(event("other"), 59_999)).toBe(true);
    expect(guard.admit(event("tick"), 60_000)).toBe(true);
  });

  it("caps the events a page sends", () => {
    const guard = new FloodGuard(3, 60_000);
    const admitted = ["a", "b", "c", "d"].map((message) => guard.admit(event(message), 0));
    expect(admitted).toEqual([true, true, true, false]);
  });
});
