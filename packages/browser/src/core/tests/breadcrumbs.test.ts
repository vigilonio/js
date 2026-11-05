import { describe, expect, it } from "vitest";
import { BreadcrumbBuffer, sanitizeBreadcrumbs } from "../breadcrumbs";
import { LIMITS } from "../limits";

const at = "2026-11-05T12:00:00.000Z";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe("BreadcrumbBuffer", () => {
  it("keeps the most recent entries, oldest first", () => {
    const buffer = new BreadcrumbBuffer(3);
    for (let i = 0; i < 5; i += 1) {
      buffer.add({ timestamp: at, category: "custom", message: `step ${i}` });
    }
    expect(buffer.snapshot().map((entry) => entry.message)).toEqual(["step 2", "step 3", "step 4"]);
  });
});

describe("sanitizeBreadcrumbs", () => {
  it("scrubs a complete URL before truncating, so a cut never keeps credentials", () => {
    // The password crosses the 256-character cut.
    const secret = `https://user:${"p".repeat(300)}@example.com/`;
    const [entry] = sanitizeBreadcrumbs([
      {
        timestamp: at,
        category: "console",
        level: "error",
        message: `failed ${secret}`,
        data: { url: secret, to: secret, note: `see ${secret}` },
      },
    ]);
    expect(entry).toEqual({
      timestamp: at,
      category: "console",
      level: "error",
      message: "failed https://example.com/",
      data: { url: "https://example.com/", to: "https://example.com/", note: "see https://example.com/" },
    });
  });

  it("removes query strings and fragments from paths and URLs", () => {
    const [entry] = sanitizeBreadcrumbs([
      {
        timestamp: at,
        category: "navigation",
        data: { from: "/users?token=t", to: "/users/42#tab" },
      },
    ]);
    expect(entry.data).toEqual({ from: "/users", to: "/users/42" });
  });

  it("drops credential-named keys, unsupported values, and keys past the caps", () => {
    const [entry] = sanitizeBreadcrumbs([
      {
        timestamp: at,
        category: "custom",
        data: {
          authorization: "Bearer x",
          apiKey: "k",
          nested: { a: 1 },
          infinite: Number.POSITIVE_INFINITY,
          ["k".repeat(33)]: "too long a key",
          ok: true,
          count: 3,
        },
      },
    ]);
    expect(entry.data).toEqual({ ok: true, count: 3 });
  });

  it("keeps at most eight data entries", () => {
    const [entry] = sanitizeBreadcrumbs([
      {
        timestamp: at,
        category: "custom",
        data: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`key${i}`, i])),
      },
    ]);
    expect(Object.keys(entry.data ?? {})).toHaveLength(LIMITS.breadcrumbDataEntries);
  });

  it("drops invalid entries and unknown levels, never the rest", () => {
    expect(
      sanitizeBreadcrumbs([
        "not an object",
        { timestamp: "later", category: "custom" },
        { timestamp: at, category: "dom" },
        { timestamp: at, category: "custom", level: "fatal", message: "" },
      ]),
    ).toEqual([{ timestamp: at, category: "custom" }]);
    expect(sanitizeBreadcrumbs(undefined)).toEqual([]);
  });

  it("truncates text after scrubbing, never splitting a surrogate pair", () => {
    const [entry] = sanitizeBreadcrumbs([
      {
        timestamp: at,
        category: "custom",
        message: `${"a".repeat(255)}😀`,
        data: { note: "n".repeat(300) },
      },
    ]);
    expect(entry.message).toBe("a".repeat(255));
    expect(entry.data?.note).toBe("n".repeat(LIMITS.breadcrumbDataValueLength));
  });

  it("keeps the newest 50, then fits the array to 16,384 UTF-8 bytes", () => {
    const sanitized = sanitizeBreadcrumbs(
      Array.from({ length: 60 }, (_, i) => ({
        timestamp: at,
        category: "custom",
        message: `${i} ${"界".repeat(300)}`,
      })),
    );
    expect(bytes(sanitized)).toBeLessThanOrEqual(LIMITS.breadcrumbsBytes);
    expect(bytes(sanitized)).toBeGreaterThan(LIMITS.breadcrumbsBytes - 1000);
    // A code-unit budget would have kept about 46 of these.
    expect(sanitized.length).toBeLessThan(25);
    expect(sanitized[sanitized.length - 1]?.message?.startsWith("59 ")).toBe(true);
  });
});
