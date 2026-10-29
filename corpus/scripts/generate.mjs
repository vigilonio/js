// Regenerates corpus/v1/: builds the fixture app three ways, loads every
// case in Playwright's Chromium, Firefox, and WebKit, and writes each event
// @vigilon/browser sent, with the build output it came from.
//
//   pnpm corpus:generate          (after `pnpm build`)
//
// Pages are served from https://corpus.vigilon.test through Playwright's
// request interception, so every URL in a stack is the same on every run.
// Event IDs, timestamps, and session IDs are replaced with fixed values for
// the same reason; what changes between runs is what the browsers changed.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import vigilon from "@vigilon/bundler-plugins/vite";
import { build } from "vite";

const corpus = fileURLToPath(new URL("..", import.meta.url));
const app = join(corpus, "app");
const out = join(corpus, "v1");
const ORIGIN = "https://corpus.vigilon.test";
const EVENTS_PATH = "/v1/browser/events";
const SETTLE_MS = 5000;

// The plugin injects debug IDs here and must never upload: a maintainer's
// own token and API URL would otherwise send the fixtures to a real project.
delete process.env.VIGILON_SOURCE_MAP_TOKEN;
delete process.env.VIGILON_API_URL;

const BUILDS = {
  // Source-mapped, with debug IDs: the frames branch.
  "mapped-a": { release: "corpus-a", sourceMaps: true },
  // The same app with a different release string, so the entry chunk's
  // hash and debug ID change while the lazy chunk's do not.
  "mapped-b": { release: "corpus-b", sourceMaps: true },
  // No source maps and no debug IDs: the fallback branch.
  unmapped: { release: "corpus-a", sourceMaps: false },
};
const ENGINES = { chromium, firefox, webkit };

const caseIds = [
  ...(await readFile(join(app, "src/cases.js"), "utf8")).matchAll(/^ {2}"([a-z0-9-]+)":/gm),
].map((match) => match[1]);

await rm(join(out, "builds"), { recursive: true, force: true });
await rm(join(out, "events"), { recursive: true, force: true });

for (const [name, { release, sourceMaps }] of Object.entries(BUILDS)) {
  await build({
    root: app,
    configFile: false,
    logLevel: "warn",
    define: { __CORPUS_RELEASE__: JSON.stringify(release) },
    build: {
      outDir: join(out, "builds", name),
      emptyOutDir: true,
      sourcemap: sourceMaps ? "hidden" : false,
      // React in a chunk of its own: frames that are never in-app, and a
      // file that stays byte for byte the same between the two releases.
      rollupOptions: {
        output: { manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined) },
      },
    },
    plugins: sourceMaps ? [vigilon()] : [],
  });
}

const engines = {};
// Cases an engine never reported, such as WebKit's "Script error." for an
// error thrown inside a native function, which the SDK drops by default.
const unreported = [];
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch();
  engines[engineName] = browser.version();
  try {
    for (const buildName of Object.keys(BUILDS)) {
      for (const caseId of caseIds) {
        const envelope = await runCase(browser, buildName, caseId);
        if (envelope === null) {
          unreported.push(`${buildName}/${engineName}/${caseId}`);
          continue;
        }
        const file = join(out, "events", buildName, engineName, `${caseId}.json`);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(normalise(envelope, buildName, engineName, caseId), null, 2)}\n`);
      }
      console.log(`${engineName} ${buildName}: ${caseIds.length} cases`);
    }
  } finally {
    await browser.close();
  }
}

const sdk = JSON.parse(await readFile(join(corpus, "../packages/browser/package.json"), "utf8"));
const playwright = JSON.parse(
  await readFile(join(corpus, "node_modules/@playwright/test/package.json"), "utf8"),
);
const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8").catch(() => "{}"));
await writeFile(
  join(out, "manifest.json"),
  `${JSON.stringify(
    {
      corpusVersion: manifest.corpusVersion ?? 1,
      origin: ORIGIN,
      sdk: `${sdk.name}@${sdk.version}`,
      playwright: playwright.version,
      engines,
      builds: BUILDS,
      cases: caseIds,
      unreported,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${relative(process.cwd(), out)}`);

/** Loads one case and returns the envelope holding its one event, or null. */
async function runCase(browser, buildName, caseId) {
  const context = await browser.newContext();
  const envelopes = [];
  await context.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === EVENTS_PATH) {
      envelopes.push(JSON.parse(request.postData() ?? "{}"));
      return route.fulfill({ status: 202, body: "{}" });
    }
    const file = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
    try {
      const body = await readFile(join(out, "builds", buildName, file));
      return route.fulfill({
        status: 200,
        body,
        contentType: file.endsWith(".js") ? "text/javascript" : "text/html",
      });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/?case=${caseId}`);
    const deadline = Date.now() + SETTLE_MS;
    while (envelopes.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(100);
      await page.evaluate(() => globalThis.__corpus?.flush(0));
    }
    // Anything further would arrive now; a case must report exactly once.
    await page.waitForTimeout(200);
    await page.evaluate(() => globalThis.__corpus?.flush(0));
  } finally {
    await context.close();
  }
  const events = envelopes.flatMap((envelope) => envelope.events);
  if (events.length === 0) {
    return null;
  }
  if (events.length !== 1) {
    throw new Error(`${buildName}/${caseId}: expected one event, got ${events.length}`);
  }
  return { ...envelopes[0], events };
}

/** Replaces the values that differ on every run with fixed ones. */
function normalise(envelope, buildName, engineName, caseId) {
  const [event] = envelope.events;
  return {
    ...envelope,
    sentAt: "2026-01-01T00:00:00.000Z",
    events: [
      {
        ...event,
        eventId: stableUuid(`${buildName}/${engineName}/${caseId}`),
        timestamp: "2026-01-01T00:00:00.000Z",
        ...(event.session ? { session: { id: "corpus-session" } } : {}),
      },
    ],
  };
}

function stableUuid(name) {
  const hex = createHash("sha256").update(name).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

