import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __VIGILON_CLI_VERSION__: JSON.stringify(version) },
  test: { include: ["src/**/*.test.ts"] },
});
