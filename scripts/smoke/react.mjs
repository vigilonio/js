// Imports the packed @vigilon/react as a server-side renderer would: no window
// or document. Every entry must load (ESM and CJS), the @vigilon/browser API
// it re-exports must stay a safe no-op, and each built file must start with
// the "use client" directive that client-only React code needs.
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as react from "@vigilon/react";
import * as reactRouter from "@vigilon/react/react-router";
import * as tanStackRouter from "@vigilon/react/tanstack-router";

const require = createRequire(import.meta.url);
const failures = [];
const check = (ok, message) => ok || failures.push(message);

check(typeof react.ErrorBoundary === "function", "ErrorBoundary must be exported");
check(typeof react.rootErrorHandlers === "function", "rootErrorHandlers must be exported");
check(react.init({ apiKey: "k", serviceName: "smoke", environment: "smoke" }) === false, "the re-exported init must not start without a browser");
check(react.captureException(new Error("ssr")) === null, "the re-exported captureException must be a no-op during SSR");
react.setRoute("/smoke/:id");
check(typeof tanStackRouter.trackTanStackRouter === "function", "the tanstack-router entry must load");
check(typeof reactRouter.trackReactRouter === "function", "the react-router entry must load");

const cjs = require("@vigilon/react");
check(typeof cjs.ErrorBoundary === "function", "the CommonJS build must load");
check(typeof require("@vigilon/react/react-router").reactRouterRouteTemplate === "function", "the CommonJS react-router entry must load");

const dist = join(dirname(require.resolve("@vigilon/react/package.json")), "dist");
for (const file of fs.readdirSync(dist).filter((name) => /\.(mjs|cjs)$/.test(name))) {
  check(fs.readFileSync(join(dist, file), "utf8").startsWith('"use client";'), `${file} must start with "use client"`);
}

if (failures.length > 0) {
  console.error(`smoke [react]: FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("smoke [react]: OK — @vigilon/react loads without a DOM (ESM and CJS), every entry is client code");
