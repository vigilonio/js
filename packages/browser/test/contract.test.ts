import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureException, close, flush, init, setTag, setUser } from "../src/index";

// Conformance against the event format's JSON Schema in contract/v1.
const contractDir = join(__dirname, "..", "contract", "v1");
const schema = JSON.parse(
  readFileSync(join(contractDir, "vigilon.browser.event@1.schema.json"), "utf8"),
);
const validFixtureDir = join(contractDir, "fixtures", "valid");
const validFixtures = readdirSync(validFixtureDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, text: readFileSync(join(validFixtureDir, name), "utf8") }));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function schemaErrors(envelope: unknown): string {
  return validate(envelope) ? "" : ajv.errorsText(validate.errors);
}

describe("contract v1", () => {
  it("pins contract version 1.0.0", () => {
    const manifest = JSON.parse(readFileSync(join(contractDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({ schema: "vigilon.browser.event@1", contractVersion: "1.0.0" });
  });

  it.each(validFixtures)("valid fixture $name validates against the schema", ({ text }) => {
    expect(schemaErrors(JSON.parse(text))).toBe("");
  });

  it("every valid fixture type-checks against the SDK's envelope type", () => {
    const source = [
      'import type { BrowserEventEnvelope } from "./src/core/envelope";',
      ...validFixtures.map(
        ({ text }, index) => `export const fixture${index}: BrowserEventEnvelope = ${text};`,
      ),
    ].join("\n");
    const fileName = join(__dirname, "..", "__contract_fixtures__.ts");
    const host = ts.createCompilerHost({});
    const readFile = host.readFile.bind(host);
    host.readFile = (name) => (name === fileName ? source : readFile(name));
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => name === fileName || fileExists(name);
    const program = ts.createProgram(
      [fileName],
      { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, skipLibCheck: true },
      host,
    );
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === fileName)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });
});

describe("every envelope the SDK sends conforms", () => {
  let bodies: unknown[];

  beforeEach(() => {
    bodies = [];
    vi.spyOn(window, "fetch").mockImplementation(async (_url, request) => {
      bodies.push(JSON.parse(String(request?.body)));
      return new Response(null, { status: 202 });
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await close();
    vi.restoreAllMocks();
  });

  it("for every kind of throwable and every optional field", async () => {
    init({
      apiKey: "k",
      serviceName: "dashboard",
      environment: "production",
      serviceVersion: "v".repeat(250),
      endpoint: "https://ingest.example.com",
      beforeSend: (event) =>
        event.exception.message === "with debug ids"
          ? {
              ...event,
              debugIds: {
                "https://app.example.com/a.js?v=1": "6f1c3a2e-8b4d-4c1a-9f0e-2d3b4c5d6e7f",
                "https://app.example.com/b.js": "malformed",
              },
              traceId: "t".repeat(200),
            }
          : event,
    });
    setUser({ id: "user_1" });
    for (let i = 0; i < 25; i += 1) setTag(`tag${i}`, "x".repeat(300));
    setTag("k".repeat(80), "too long a key");

    const deep = new Error("top", {
      cause: new Error("middle", { cause: new Error("bottom", { cause: { odd: true } }) }),
    });
    const throwables: unknown[] = [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      "a thrown string",
      { code: 42 },
      undefined,
      null,
      123,
      deep,
      new Error("😀".repeat(5000)),
      Object.assign(new Error("x"), { name: "N".repeat(400) }),
      Object.assign(new Error("long stack"), {
        stack: Array.from({ length: 400 }, (_, i) => `    at f${i} (https://a.example.com/x.js?q=${i}:1:1)`).join("\n"),
      }),
      new Error("with debug ids"),
    ];
    throwables.forEach((throwable, index) =>
      captureException(throwable, {
        route: index % 2 === 0 ? "/users/$id" : "r".repeat(300),
        componentStack: index === 0 ? "\n    at UserCard".repeat(5000) : undefined,
      }),
    );
    window.dispatchEvent(new ErrorEvent("error", { error: new SyntaxError("uncaught") }));

    await flush();
    const events = bodies.flatMap((body) => (body as { events: unknown[] }).events);
    expect(events).toHaveLength(throwables.length + 1);
    for (const body of bodies) {
      expect(schemaErrors(body)).toBe("");
    }
  });
});
