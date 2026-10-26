import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserEvent, BrowserEventEnvelope } from "../envelope";
import { parseRetryAfter, Transport } from "../transport";

interface Sent {
  envelope: BrowserEventEnvelope;
  keepalive: boolean;
  headers: Record<string, string>;
  bytes: number;
}

type Reply = { status: number; retryAfter?: string } | "network-error";

function event(n: number, padding = 0): BrowserEvent {
  return {
    type: "exception",
    eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    timestamp: "2026-10-26T00:00:00.000Z",
    exception: {
      type: "Error",
      message: `e${n}${"x".repeat(padding)}`,
      stack: null,
      mechanism: "manual",
      handled: true,
    },
    page: { url: "https://app.example.com/" },
  };
}

describe("Transport", () => {
  let sent: Sent[];
  let replies: Reply[];
  let transport: Transport;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse("2026-10-26T12:00:00.000Z") });
    sent = [];
    replies = [];
    transport = new Transport({
      url: "https://ingest.example.com/v1/browser/events",
      apiKey: "test-key",
      envelope: {
        schema: "vigilon.browser.event@1",
        sdk: { name: "@vigilon/browser", version: "0.0.0-test" },
        service: { name: "web", environment: "test" },
      },
      now: () => Date.now(),
      debug: () => undefined,
      fetch: async (_url, init) => {
        sent.push({
          envelope: JSON.parse(init.body),
          keepalive: init.keepalive,
          headers: init.headers,
          bytes: init.body.length,
        });
        const reply = replies.shift() ?? { status: 202 };
        if (reply === "network-error") {
          throw new TypeError("Failed to fetch");
        }
        return {
          status: reply.status,
          headers: { get: (name: string) => (name === "Retry-After" ? (reply.retryAfter ?? null) : null) },
        };
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches queued events into one request after a short delay", async () => {
    transport.enqueue(event(1));
    transport.enqueue(event(2));
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0].envelope.events.map((e) => e.exception.message)).toEqual(["e1", "e2"]);
    expect(sent[0].headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(sent[0].keepalive).toBe(false);
  });

  it("sends at most 20 events per request", async () => {
    for (let i = 0; i < 45; i += 1) transport.enqueue(event(i));
    await transport.flush();
    expect(sent.map((s) => s.envelope.events.length)).toEqual([20, 20, 5]);
  });

  it("keeps each request under the body cap", async () => {
    for (let i = 0; i < 6; i += 1) transport.enqueue(event(i, 60 * 1024));
    await transport.flush();
    expect(sent.length).toBeGreaterThan(1);
    expect(Math.max(...sent.map((s) => s.bytes))).toBeLessThan(250 * 1024);
  });

  it("pauses every send for Retry-After on 429, then retries with a new sentAt", async () => {
    replies.push({ status: 429, retryAfter: "30" });
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    transport.enqueue(event(2));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(2);
    expect(sent[1].envelope.events.map((e) => e.exception.message)).toEqual(["e1", "e2"]);
    expect(sent[1].envelope.sentAt).not.toBe(sent[0].envelope.sentAt);
  });

  it("waits 10 seconds after a 503 without Retry-After", async () => {
    replies.push({ status: 503 });
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
  });

  it("retries a network failure with backoff", async () => {
    replies.push("network-error");
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(2);
  });

  it.each([400, 401, 403, 413, 500])("drops the batch on %i without retrying", async (status) => {
    replies.push({ status });
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(sent).toHaveLength(1);
  });

  it("drops an event after five attempts", async () => {
    for (let i = 0; i < 10; i += 1) replies.push({ status: 503, retryAfter: "1" });
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(5);
  });

  it("drops an event 30 minutes after its first attempt", async () => {
    replies.push({ status: 429, retryAfter: "1900" });
    transport.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1900 * 1000);
    expect(sent).toHaveLength(1);
  });

  it("flushes on unload with keepalive, within the 64 KB keepalive budget", () => {
    for (let i = 0; i < 5; i += 1) transport.enqueue(event(i, 20 * 1024));
    transport.flushOnUnload();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((s) => s.keepalive)).toBe(true);
    expect(sent.reduce((total, s) => total + s.bytes, 0)).toBeLessThan(64 * 1024);
  });

  it("bounds the queue", async () => {
    for (let i = 0; i < 150; i += 1) transport.enqueue(event(i));
    await transport.flush();
    expect(sent.reduce((total, s) => total + s.envelope.events.length, 0)).toBe(100);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-10-26T12:00:00.000Z");
    expect(parseRetryAfter("60", now)).toBe(60_000);
    expect(parseRetryAfter("Mon, 26 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});
