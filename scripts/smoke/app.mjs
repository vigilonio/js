// ESM consumer app, started with `node --import @vigilon/node/register`.
import assert from "node:assert";
import http from "node:http";
import express from "express";
import * as vigilon from "@vigilon/node";

for (const name of ["register", "registerFromEnv", "shutdown", "recordException", "withJobMonitor"]) {
  assert(typeof vigilon[name] === "function", `${name} is exported (ESM)`);
}

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
