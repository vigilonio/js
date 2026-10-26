import { describe, expect, it } from "vitest";
import { scrubUrl, scrubUrlsInText, truncate, truncateStack } from "../text";

describe("truncate", () => {
  it("never splits a surrogate pair", () => {
    expect(truncate("ab😀", 3)).toBe("ab");
    expect(truncate("ab😀", 4)).toBe("ab😀");
    expect(truncate("abc", 5)).toBe("abc");
  });
});

describe("truncateStack", () => {
  it("keeps the top 250 lines, then caps the length", () => {
    const stack = Array.from({ length: 300 }, (_, i) => `    at f${i} (a.js:1:1)`).join("\n");
    const kept = truncateStack(stack).split("\n");
    expect(kept).toHaveLength(250);
    expect(kept[0]).toBe("    at f0 (a.js:1:1)");
    expect(truncateStack("x".repeat(70 * 1024))).toHaveLength(64 * 1024);
  });
});

describe("URL scrub", () => {
  it("removes the query, fragment, and userinfo of a URL", () => {
    expect(scrubUrl("https://user:pass@app.example.com/a?token=1#frag")).toBe(
      "https://app.example.com/a",
    );
    expect(scrubUrl("https://app.example.com/a#x?y")).toBe("https://app.example.com/a");
  });

  it("scrubs URLs inside a stack and keeps line, column, and punctuation", () => {
    const stack = [
      "TypeError: boom",
      "    at render (https://app.example.com/assets/index.js?v=abc:12:3456)",
      "UserCard@https://app.example.com/assets/index.js#x:1:2",
      "    at eval (eval at outer (https://u:p@app.example.com/x.js?q=1:1:2), <anonymous>:3:4)",
    ].join("\n");
    expect(scrubUrlsInText(stack)).toBe(
      [
        "TypeError: boom",
        "    at render (https://app.example.com/assets/index.js:12:3456)",
        "UserCard@https://app.example.com/assets/index.js:1:2",
        "    at eval (eval at outer (https://app.example.com/x.js:1:2), <anonymous>:3:4)",
      ].join("\n"),
    );
  });
});
