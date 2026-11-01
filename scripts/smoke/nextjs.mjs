// Loads the packed @vigilon/nextjs as Next.js would: the client entry without
// a DOM (Next.js renders client components on the server too), the server and
// config entries in Node, ESM and CJS. Only the client entry may carry the
// "use client" directive, and the preload entrypoints must ship.
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as client from "@vigilon/nextjs";
import { withVigilon } from "@vigilon/nextjs/config";
import * as server from "@vigilon/nextjs/server";

const require = createRequire(import.meta.url);
const failures = [];
const check = (ok, message) => ok || failures.push(message);

check(client.init({ apiKey: "k", serviceName: "smoke", environment: "smoke" }) === false, "the client init must not start without a browser");
check(typeof client.useReportError === "function", "useReportError must be exported");
check(typeof client.ErrorBoundary === "function", "the @vigilon/react API must be re-exported");
check(typeof server.register === "function" && typeof server.recordException === "function", "the server entry must export register and the @vigilon/node API");

const config = withVigilon({ serverExternalPackages: ["pg"] });
check(config.serverExternalPackages.includes("@vigilon/nextjs") && config.serverExternalPackages.includes("pg"), "withVigilon must keep the SDK external");
check(config.experimental.clientTraceMetadata.includes("traceparent"), "withVigilon must turn on the traceparent meta tag");
check(typeof require("@vigilon/nextjs/config").withVigilon === "function", "the CommonJS config entry must load (next.config.js)");
check(typeof require("@vigilon/nextjs/server").register === "function", "the CommonJS server entry must load");

const root = dirname(require.resolve("@vigilon/nextjs/package.json"));
for (const file of ["index.mjs", "index.cjs"]) {
  check(fs.readFileSync(join(root, "dist", file), "utf8").startsWith('"use client";'), `${file} must start with "use client"`);
}
for (const file of ["server.mjs", "server.cjs", "config.mjs", "config.cjs"]) {
  check(!fs.readFileSync(join(root, "dist", file), "utf8").includes('"use client"'), `${file} must not be client code`);
}
check(fs.existsSync(join(root, "register.mjs")) && fs.existsSync(join(root, "register.cjs")), "the preload entrypoints must ship");

if (failures.length > 0) {
  console.error(`smoke [nextjs]: FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("smoke [nextjs]: OK — client, server, and config entries load (ESM and CJS); only the client is \"use client\"");
