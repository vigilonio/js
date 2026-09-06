// Asserts that collector.log holds a trace export carrying the given markers
// (default: an HTTP server span named after the Express route and an Express
// handler span). Usage: node assert.mjs <label> [marker ...]
import fs from "node:fs";

const [label, ...requested] = process.argv.slice(2);
const required = requested.length > 0 ? requested : ["httpServerSpan", "expressSpan"];
const exports_ = fs.existsSync("collector.log")
  ? fs.readFileSync("collector.log", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const traces = exports_.filter((e) => e.path === "/v1/traces");
const seen = new Set(traces.flatMap((e) => e.markers));

const missing = required.filter((m) => !seen.has(m));
if (traces.length === 0 || missing.length > 0) {
  console.error(`smoke [${label}]: FAILED — ${traces.length} trace export(s), missing markers: ${missing.join(", ") || "none"}`);
  console.error(JSON.stringify(exports_, null, 2));
  process.exit(1);
}
console.log(`smoke [${label}]: OK — exported spans carry ${required.join(", ")}`);
