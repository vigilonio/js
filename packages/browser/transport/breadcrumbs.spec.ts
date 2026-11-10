import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/*
 * Automatic breadcrumbs in real engines: the History API, a click, console
 * warnings and errors, fetch, and XMLHttpRequest, recorded by the built
 * script-tag bundle and sent with the next error. The application's own calls
 * must keep working, and the SDK's requests to the endpoint are never
 * recorded.
 */

const bundle = readFileSync(join(__dirname, "..", "dist", "vigilon.min.js"), "utf8");
let bodies: string[] = [];
let endpoint: http.Server;
let site: http.Server;
let endpointOrigin: string;
let siteOrigin: string;

function listen(server: http.Server, host: string): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://${host}:${port}`);
    }),
  );
}

test.beforeAll(async () => {
  endpoint = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.writeHead(204).end();
        return;
      }
      bodies.push(body);
      res.writeHead(202, { "Content-Type": "application/json" }).end('{"accepted":1}');
    });
  });
  site = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/vigilon.min.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle);
    } else if (url.pathname.startsWith("/api/")) {
      res.writeHead(url.pathname === "/api/missing" ? 404 : 200, { "Content-Type": "text/plain" }).end("ok");
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end(page());
    }
  });
  endpointOrigin = await listen(endpoint, "127.0.0.1");
  siteOrigin = await listen(site, "localhost");
});

test.afterAll(() => {
  endpoint.close();
  site.close();
});

test.beforeEach(() => {
  bodies = [];
});

function page(): string {
  return `<!doctype html><meta charset="utf-8">
<button id="pay" class="btn primary extra">Pay jane@example.com</button>
<script src="/vigilon.min.js"></script>
<script>
  Vigilon.init({
    apiKey: "breadcrumb-test-key",
    appName: "breadcrumb-test",
    environment: "test",
    appVersion: "1",
    endpoint: ${JSON.stringify(endpointOrigin)},
  });
  window.run = async () => {
    // A warm-up error, so the SDK's own request precedes the recorded ones.
    Vigilon.captureException(new Error("warm up"));
    await Vigilon.flush();
    history.pushState(null, "", "/checkout?token=t#step");
    document.getElementById("pay").click();
    console.warn("retrying payment");
    console.log("not recorded by default");
    const fetched = await fetch("/api/missing?sig=s");
    const xhrStatus = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/report?key=k");
      xhr.onloadend = () => resolve(xhr.status);
      xhr.send("{}");
    });
    Vigilon.addBreadcrumb({ message: "payment submitted", data: { step: 2 } });
    Vigilon.captureException(new Error("payment failed"));
    // A handler assigned before open() captures at DONE: the request is
    // already a breadcrumb. Browsers refuse a credentialed URL, and the
    // failed request is still recorded, without its credentials.
    await fetch("//alice:secret@" + location.host + "/api/creds?token=t").catch(() => undefined);
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          Vigilon.captureException(new Error("report done"));
          resolve(undefined);
        }
      };
      xhr.open("GET", "/api/early");
      xhr.send();
    });
    await Vigilon.flush();
    return { fetchStatus: fetched.status, xhrStatus };
  };
</script>`;
}

test("records breadcrumbs from the page and sends them with the next error", async ({ page }) => {
  await page.goto(siteOrigin + "/start");
  const app = await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run());
  // The application's own requests are unaffected by the wrappers.
  expect(app).toEqual({ fetchStatus: 404, xhrStatus: 200 });

  const events = bodies.flatMap((body) => JSON.parse(body).events);
  const failed = events.find((event) => event.exception.message === "payment failed");
  const breadcrumbs = failed.breadcrumbs as Array<{ category: string; level?: string; message?: string; data?: Record<string, unknown> }>;

  expect(breadcrumbs.map((entry) => entry.category)).toEqual([
    "navigation",
    "click",
    "console",
    "fetch",
    "xhr",
    "custom",
  ]);
  expect(breadcrumbs[0].data).toEqual({ from: "/start", to: "/checkout" });
  expect(breadcrumbs[1].message).toBe("button#pay.btn.primary");
  expect(breadcrumbs[2]).toMatchObject({ level: "warning", message: "retrying payment" });
  expect(breadcrumbs[3]).toMatchObject({
    level: "warning",
    data: { method: "GET", url: "/api/missing", status_code: 404 },
  });
  expect(breadcrumbs[4]).toMatchObject({ data: { method: "POST", url: "/api/report", status_code: 200 } });
  expect(breadcrumbs[5]).toMatchObject({ category: "custom", message: "payment submitted", data: { step: 2 } });

  const done = events.find((event) => event.exception.message === "report done");
  const last = done.breadcrumbs.slice(-2);
  expect(last[0]).toMatchObject({
    category: "fetch",
    level: "error",
    data: { url: expect.stringMatching(/^\/\/localhost:\d+\/api\/creds$/), status_code: 0 },
  });
  expect(last[1]).toMatchObject({ category: "xhr", data: { url: "/api/early", status_code: 200 } });
  expect(JSON.stringify(bodies)).not.toMatch(/alice|secret|token=t/);

  const sent = JSON.stringify(breadcrumbs);
  expect(sent).not.toContain("jane");
  expect(sent).not.toContain(endpointOrigin);
  expect(sent).not.toMatch(/token=|sig=|key=/);
});
