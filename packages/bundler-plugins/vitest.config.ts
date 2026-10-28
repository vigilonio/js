import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // The bundler tests run real builds.
    testTimeout: 60_000,
  },
});
