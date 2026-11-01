import { defineConfig } from "vitest/config";

// Server and config tests run in Node; client tests opt into a DOM with a
// `@vitest-environment happy-dom` comment.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
