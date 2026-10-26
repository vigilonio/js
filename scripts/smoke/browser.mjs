// Imports the packed @vigilon/browser as an ESM consumer would during SSR:
// no window or document. Every call must be a safe no-op, and the script-tag
// build must ship where the unpkg and jsdelivr fields point.
import fs from "node:fs";
import { createRequire } from "node:module";
import * as browser from "@vigilon/browser";

const require = createRequire(import.meta.url);
const failures = [];
const check = (ok, message) => ok || failures.push(message);

check(browser.init({ apiKey: "k", serviceName: "smoke", environment: "smoke" }) === false, "init must not start without a browser");
check(browser.captureException(new Error("ssr")) === null, "captureException must be a no-op during SSR");
check((await browser.flush()) === true, "flush must resolve during SSR");
check(typeof browser.SDK_VERSION === "string" && browser.SDK_VERSION.length > 0, "SDK_VERSION must be set");

const cjs = require("@vigilon/browser");
check(typeof cjs.init === "function" && cjs.init({}) === false, "the CommonJS build must load and no-op");

const manifest = JSON.parse(fs.readFileSync(require.resolve("@vigilon/browser/package.json"), "utf8"));
const iife = new URL(manifest.unpkg, `file://${require.resolve("@vigilon/browser/package.json")}`);
check(manifest.unpkg === manifest.jsdelivr && fs.existsSync(iife), `script-tag build missing at ${manifest.unpkg}`);
check(manifest.sideEffects === false, "package must declare sideEffects: false");

if (failures.length > 0) {
  console.error(`smoke [browser]: FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`smoke [browser]: OK — @vigilon/browser ${browser.SDK_VERSION} is a no-op during SSR (ESM and CJS), script-tag build shipped`);
