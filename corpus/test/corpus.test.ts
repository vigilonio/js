// Checks the committed corpus is complete and consistent without running a
// browser: every case has an event per build and engine, every event matches
// the browser event format, every debug ID points at a committed script and
// map, and every pair of events resolves to one expected outcome.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const v1 = join(root, "v1");
const read = (path: string) => JSON.parse(readFileSync(join(v1, path), "utf8"));

interface Selector {
  cases?: string[];
  engines?: string[];
  builds?: string[];
}
interface Accepted {
  outcome: "accepted-collision" | "accepted-split";
  reason: string;
  note?: string;
  events: Selector;
  versus?: Selector;
}
interface CorpusEvent {
  case: string;
  engine: string;
  build: string;
}

const manifest = read("manifest.json");
const expectations = read("expectations.json") as {
  branches: Record<string, string[]>;
  reasons: Record<string, string>;
  bugs: Record<string, string>;
  accepted: Accepted[];
};
const builds = Object.keys(manifest.builds);
const engines = Object.keys(manifest.engines);
const cases: string[] = manifest.cases;
const unreported = new Set<string>(manifest.unreported);

const events: CorpusEvent[] = builds.flatMap((build) =>
  engines.flatMap((engine) =>
    cases
      .filter((id) => !unreported.has(`${build}/${engine}/${id}`))
      .map((id) => ({ case: id, engine, build })),
  ),
);

const matches = (event: CorpusEvent, selector: Selector) =>
  (selector.cases ?? cases).includes(event.case) &&
  (selector.engines ?? engines).includes(event.engine) &&
  (selector.builds ?? builds).includes(event.build);

/** The expected outcome of one pair, as corpus/v1/README.md defines it. */
function outcome(a: CorpusEvent, b: CorpusEvent): string {
  const sameBug = expectations.bugs[a.case] === expectations.bugs[b.case];
  const accepted = expectations.accepted.find((entry) =>
    sameBug
      ? entry.outcome === "accepted-split" &&
        entry.versus !== undefined &&
        ((matches(a, entry.events) && matches(b, entry.versus)) ||
          (matches(b, entry.events) && matches(a, entry.versus)))
      : entry.outcome === "accepted-collision" && matches(a, entry.events) && matches(b, entry.events),
  );
  return accepted ? accepted.outcome : sameBug ? "must-join" : "must-separate";
}

describe("manifest", () => {
  it("lists the cases the fixture app runs, the engines, and the builds", () => {
    const source = readFileSync(join(root, "app/src/cases.js"), "utf8");
    const appCases = [...source.matchAll(/^ {2}"([a-z0-9-]+)":/gm)].map((match) => match[1]);
    expect(cases).toEqual(appCases);
    expect(engines.sort()).toEqual(["chromium", "firefox", "webkit"]);
    expect(builds.sort()).toEqual(Object.values(expectations.branches).flat().sort());
    expect(manifest.corpusVersion).toBe(1);
  });

  it("names unreported events by build, engine, and case", () => {
    for (const entry of unreported) {
      const [build, engine, id] = entry.split("/");
      expect(builds).toContain(build);
      expect(engines).toContain(engine);
      expect(cases).toContain(id);
    }
  });
});

describe("events", () => {
  const schema = JSON.parse(
    readFileSync(join(root, "../packages/browser/contract/v1/vigilon.browser.event@1.schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  it.each(builds)("%s has one valid event per case and engine", (build) => {
    const release = manifest.builds[build].release;
    for (const event of events.filter((candidate) => candidate.build === build)) {
      const path = `events/${build}/${event.engine}/${event.case}.json`;
      expect(existsSync(join(v1, path)), path).toBe(true);
      const envelope = read(path);
      expect(validate(envelope), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      expect(envelope.events, path).toHaveLength(1);
      expect(envelope.service.version).toBe(release);
      expect(envelope.events[0].page.url.startsWith(manifest.origin)).toBe(true);
    }
  });

  it("points every debug ID of a mapped build at a committed script and map", () => {
    for (const event of events.filter(({ build }) => manifest.builds[build].sourceMaps)) {
      const path = `events/${event.build}/${event.engine}/${event.case}.json`;
      const debugIds = read(path).events[0].debugIds ?? {};
      expect(Object.keys(debugIds).length, path).toBeGreaterThan(0);
      for (const [url, debugId] of Object.entries(debugIds)) {
        const script = join("builds", event.build, new URL(url).pathname);
        expect(readFileSync(join(v1, script), "utf8")).toContain(`//# debugId=${debugId}`);
        expect(read(`${script}.map`).debugId).toBe(debugId);
      }
    }
  });

  it("gives unmapped builds no debug IDs and no source maps", () => {
    for (const build of builds.filter((name) => !manifest.builds[name].sourceMaps)) {
      const files = readdirSync(join(v1, "builds", build), { recursive: true }) as string[];
      expect(files.filter((file) => file.endsWith(".map"))).toEqual([]);
      for (const event of events.filter((candidate) => candidate.build === build)) {
        expect(read(`events/${build}/${event.engine}/${event.case}.json`).events[0].debugIds).toBeUndefined();
      }
    }
  });
});

describe("expectations", () => {
  it("labels every case with a bug, and some bugs with several cases", () => {
    expect(Object.keys(expectations.bugs).sort()).toEqual([...cases].sort());
    const casesPerBug = new Map<string, number>();
    for (const bug of Object.values(expectations.bugs)) {
      casesPerBug.set(bug, (casesPerBug.get(bug) ?? 0) + 1);
    }
    expect([...casesPerBug.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(5);
  });

  it("gives every accepted outcome a known reason and selectors that match events", () => {
    for (const entry of expectations.accepted) {
      expect(["accepted-collision", "accepted-split"]).toContain(entry.outcome);
      expect(Object.keys(expectations.reasons)).toContain(entry.reason);
      expect(entry.versus === undefined).toBe(entry.outcome === "accepted-collision");
      for (const selector of [entry.events, entry.versus].filter((s): s is Selector => s !== undefined)) {
        for (const id of selector.cases ?? []) expect(cases).toContain(id);
        for (const engine of selector.engines ?? []) expect(engines).toContain(engine);
        for (const build of selector.builds ?? []) expect(builds).toContain(build);
        expect(events.some((event) => matches(event, selector)), JSON.stringify(selector)).toBe(true);
      }
    }
    const used = new Set(expectations.accepted.map((entry) => entry.reason));
    expect([...used].sort()).toEqual(Object.keys(expectations.reasons).sort());
  });

  it("makes every accepted entry apply to at least one pair", () => {
    for (const entry of expectations.accepted) {
      const selected = events.filter((event) => matches(event, entry.events));
      const applies =
        entry.outcome === "accepted-collision"
          ? selected.some((a) => selected.some((b) => expectations.bugs[a.case] !== expectations.bugs[b.case]))
          : selected.some((a) =>
              events.some(
                (b) => matches(b, entry.versus!) && expectations.bugs[a.case] === expectations.bugs[b.case],
              ),
            );
      expect(applies, `${entry.outcome} ${entry.reason} ${JSON.stringify(entry.events)}`).toBe(true);
    }
  });

  it("resolves every pair to one outcome, with must-join and must-separate pairs to test", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const result = outcome(events[i], events[j]);
        counts[result] = (counts[result] ?? 0) + 1;
      }
    }
    expect(Object.keys(counts).sort()).toEqual([
      "accepted-collision",
      "accepted-split",
      "must-join",
      "must-separate",
    ]);
  });
});
