import { describe, expect, it } from "vitest";
import {
  sanitizeDebugIds,
  sanitizeIdentifier,
  sanitizeTags,
  sanitizeUserId,
} from "../privacy";

describe("sanitizeTags", () => {
  it("drops credential-like keys and over-long keys, and truncates values", () => {
    expect(
      sanitizeTags({
        plan: "pro",
        Password: "x",
        session_token: "x",
        Authorization: "x",
        ["k".repeat(65)]: "x",
        "": "x",
        note: "v".repeat(300),
      }),
    ).toEqual({ plan: "pro", note: "v".repeat(256) });
  });

  it("keeps at most 20 entries", () => {
    const tags = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`t${i}`, "v"]));
    expect(Object.keys(sanitizeTags(tags))).toHaveLength(20);
  });
});

describe("identifiers", () => {
  it("nulls an identifier over 128 characters instead of truncating it", () => {
    expect(sanitizeIdentifier("a".repeat(128))).toBe("a".repeat(128));
    expect(sanitizeIdentifier("a".repeat(129))).toBeNull();
    expect(sanitizeIdentifier("")).toBeNull();
    expect(sanitizeIdentifier(42)).toBeNull();
  });

  it("drops a user ID that looks like an email address", () => {
    expect(sanitizeUserId("user_123")).toBe("user_123");
    expect(sanitizeUserId("ada@example.com")).toBeNull();
  });
});

describe("sanitizeDebugIds", () => {
  it("scrubs keys and keeps only UUID values", () => {
    expect(
      sanitizeDebugIds({
        "https://app.example.com/a.js?v=1": "6f1c3a2e-8b4d-4c1a-9f0e-2d3b4c5d6e7f",
        "https://app.example.com/b.js": "not-a-uuid",
      }),
    ).toEqual({ "https://app.example.com/a.js": "6f1c3a2e-8b4d-4c1a-9f0e-2d3b4c5d6e7f" });
  });
});
