import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  // The bundler plugins' injection and upload code is inlined from source,
  // so the CLI has no runtime dependencies.
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  banner: { js: "#!/usr/bin/env node" },
  define: { __VIGILON_CLI_VERSION__: JSON.stringify(version) },
  sourcemap: true,
  clean: true,
  platform: "node",
  target: "node22",
});
