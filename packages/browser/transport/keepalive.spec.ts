import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/*
 * An error captured just before the page goes away must still reach a
 * cross-site endpoint. The SDK's request carries Authorization and JSON, so it
 * needs a CORS preflight, and it is sent with keepalive from the
 * visibilitychange-to-hidden handler, with pagehide as a fallback.
 *
 * The page and the endpoint are different sites (localhost and 127.0.0.1). A
 * sendBeacon sentinel from the page's own visibilitychange and pagehide
 * listeners shows that the page-hide handlers ran, so a missing event means
 * the browser dropped the request rather than never sending it.
 */

interface Recorded {
  method: string;
  path: string;
  authorization: string | undefined;
  body: string;
}

const bundle = readFileSync(join(__dirname, "..", "dist", "vigilon.min.js"), "utf8");
let recorded: Recorded[] = [];
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
      recorded.push({
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Max-Age", "7200");
        res.writeHead(204).end();
        return;
      }
      res.writeHead(202, { "Content-Type": "application/json" }).end('{"accepted":1}');
    });
  });
  site = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/vigilon.min.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle);
      return;
    }
    if (url.pathname === "/next") {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<p>next</p>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" }).end(page(url.searchParams));
  });
  endpointOrigin = await listen(endpoint, "127.0.0.1");
  siteOrigin = await listen(site, "localhost");
});

test.afterAll(() => {
  endpoint.close();
  site.close();
});

test.beforeEach(() => {
  recorded = [];
});

function page(params: URLSearchParams): string {
  const run = params.get("run");
  const warm = params.get("preflight") === "warm";
  return `<!doctype html><meta charset="utf-8">
<script src="/vigilon.min.js"></script>
<script>
  const sentinel = () => navigator.sendBeacon(${JSON.stringify(endpointOrigin)} + "/sentinel/${run}", "ran");
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sentinel();
  });
  addEventListener("pagehide", sentinel);
  Vigilon.init({
    apiKey: "transport-test-key",
    serviceName: "transport-test",
    environment: "test",
    serviceVersion: "1",
    endpoint: ${JSON.stringify(endpointOrigin)},
  });
  (async () => {
    if (${warm}) {
      Vigilon.captureException(new Error("warm the preflight cache"));
      await Vigilon.flush();
    }
    window.__eventId = Vigilon.captureException(new Error("leaving ${run}"));
  })();
</script>`;
}

async function eventuallyRecorded(predicate: (entry: Recorded) => boolean): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (recorded.some(predicate)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

for (const preflight of ["cold", "warm"] as const) {
  for (const trigger of ["navigate", "close"] as const) {
    test(`delivers an event on ${trigger} with a ${preflight} preflight cache`, async ({
      browser,
    }) => {
      const run = `${preflight}-${trigger}-${Date.now()}`;
      const context = await browser.newContext();
      const tab = await context.newPage();
      await tab.goto(`${siteOrigin}/?run=${run}&preflight=${preflight}`);
      const eventId = await tab.waitForFunction(() => (window as { __eventId?: string }).__eventId);
      const id = (await eventId.jsonValue()) as string;
      // Leave before the SDK's one-second batch timer fires, so only the
      // page-hide flush can deliver the event.
      if (trigger === "navigate") {
        await tab.goto(`${siteOrigin}/next`);
      } else {
        await tab.close();
      }

      const delivered = await eventuallyRecorded(
        (entry) => entry.method === "POST" && entry.path === "/v1/browser/events" && entry.body.includes(id),
      );
      const handlerRan = await eventuallyRecorded((entry) => entry.path === `/sentinel/${run}`);
      await context.close();

      expect(handlerRan, "the page-hide handlers ran (sentinel beacon)").toBe(true);
      expect(delivered, "the SDK's keepalive request reached the endpoint").toBe(true);
      const post = recorded.find((entry) => entry.method === "POST" && entry.body.includes(id));
      expect(post?.authorization).toBe("Bearer transport-test-key");
      if (preflight === "cold") {
        expect(recorded.some((entry) => entry.method === "OPTIONS")).toBe(true);
      }
    });
  }
}
