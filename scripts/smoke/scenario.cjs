// The test scenario shared by app.cjs and app.mjs. Only the module-format
// specific part — how express and @vigilon/node are imported — lives in the
// app files, because that import path is exactly what each variant tests.
const assert = require("node:assert");
const http = require("node:http");

const PUBLIC_API = ["register", "registerFromEnv", "shutdown", "recordException", "withJobMonitor"];

function runScenario({ label, express, vigilon }) {
  for (const name of PUBLIC_API) {
    assert(typeof vigilon[name] === "function", `${name} is exported (${label})`);
  }

  const timer = setTimeout(() => {
    console.error(`smoke app (${label}) timed out`);
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
}

module.exports = { runScenario };
