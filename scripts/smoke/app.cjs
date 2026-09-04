// CommonJS consumer app, started with `node --require @vigilon/node/register`.
const assert = require("node:assert");
const http = require("node:http");
const express = require("express");
const vigilon = require("@vigilon/node");

for (const name of ["register", "registerFromEnv", "shutdown", "recordException", "withJobMonitor"]) {
  assert(typeof vigilon[name] === "function", `${name} is exported (CJS)`);
}
assert(require.resolve("@vigilon/node/register").endsWith("register.cjs"), "register preload resolves (CJS)");

const timer = setTimeout(() => {
  console.error("smoke app timed out");
  process.exit(1);
}, 20000);

const app = express();
app.get("/hello", (req, res) => res.json({ ok: true }));
const server = app.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  http.get(`http://127.0.0.1:${port}/hello`, (res) => {
    res.resume();
    res.on("end", async () => {
      await vigilon.shutdown();
      server.close();
      clearTimeout(timer);
    });
  });
});
