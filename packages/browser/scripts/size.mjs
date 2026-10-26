// Fails when the SDK grows past its budget. Measures what a bundler ships for
// `import { init } from "@vigilon/browser"` (the ESM build, minified and
// gzipped) and the script-tag build as published.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGET_BYTES = 8 * 1024;

const bundled = await build({
  stdin: {
    contents: 'export { init, captureException } from "./dist/index.mjs";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  logLevel: "silent",
});
const sizes = {
  "ESM import (init, captureException)": gzipSync(bundled.outputFiles[0].contents).length,
  "IIFE dist/vigilon.min.js": gzipSync(readFileSync("dist/vigilon.min.js")).length,
};

let failed = false;
for (const [label, bytes] of Object.entries(sizes)) {
  const over = bytes > BUDGET_BYTES;
  failed ||= over;
  console.log(
    `${over ? "FAIL" : "ok  "} ${label}: ${(bytes / 1024).toFixed(2)} KB gzip (budget ${BUDGET_BYTES / 1024} KB)`,
  );
}
process.exitCode = failed ? 1 : 0;
