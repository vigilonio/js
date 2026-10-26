import type { BrowserEvent, BrowserEventEnvelope } from "./envelope";
import { LIMITS } from "./limits";

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    keepalive: boolean;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
}>;

export interface TransportOptions {
  url: string;
  apiKey: string;
  envelope: Pick<BrowserEventEnvelope, "schema" | "sdk" | "service">;
  fetch: FetchLike;
  now: () => number;
  debug: (message: string) => void;
}

interface Pending {
  event: BrowserEvent;
  bytes: number;
  attempts: number;
  firstAttemptAt: number | null;
}

/** Wait before sending, so a burst of errors goes out as one request. */
const BATCH_DELAY_MS = 1000;
/** The endpoint rejects bodies over 256 KB; stay clear of it. */
const MAX_BODY_BYTES = 240 * 1024;
/** Browsers allow 64 KB of keepalive bodies in flight per document. */
const KEEPALIVE_BUDGET_BYTES = 60 * 1024;
const ENVELOPE_OVERHEAD_BYTES = 512;
const MAX_QUEUE = 100;
const MAX_ATTEMPTS = 5;
/** An event is dropped this long after its first attempt. */
const MAX_RETRY_AGE_MS = 30 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = { 429: 60_000, 503: 10_000 } as const;
const MAX_BACKOFF_MS = 60_000;

/**
 * Batches events into POSTs to the browser event endpoint. Retries only 429,
 * 503, and network failure; a Retry-After pauses every send. An event is
 * dropped after MAX_ATTEMPTS or 30 minutes after its first attempt, so
 * delivery is at-least-once within that bound, never guaranteed.
 */
export class Transport {
  private queue: Pending[] = [];
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loop: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly options: TransportOptions) {}

  enqueue(event: BrowserEvent): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.options.debug("queue full; event dropped");
      return;
    }
    this.queue.push({
      event,
      bytes: byteLength(JSON.stringify(event)),
      attempts: 0,
      firstAttemptAt: null,
    });
    this.schedule(BATCH_DELAY_MS);
  }

  /** Sends everything queued. Resolves true when nothing is left. */
  async flush(timeoutMs = 2000): Promise<boolean> {
    this.cancelTimer();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.drain().then(() => Promise.all(this.inFlight)),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    return this.queue.length === 0 && this.inFlight.size === 0;
  }

  /**
   * Called when the page is hidden or unloading: sends what fits in the
   * keepalive budget synchronously, so the requests outlive the page.
   */
  flushOnUnload(): void {
    this.cancelTimer();
    if (this.options.now() < this.pausedUntil) {
      return;
    }
    let budget = KEEPALIVE_BUDGET_BYTES;
    while (this.queue.length > 0) {
      const batch = this.takeBatch(budget);
      if (batch.length === 0) {
        break;
      }
      budget -= batchBytes(batch);
      this.track(this.post(batch, true));
    }
  }

  close(): void {
    this.cancelTimer();
    this.queue = [];
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null || this.queue.length === 0) {
      return;
    }
    const wait = Math.max(delayMs, this.pausedUntil - this.options.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private drain(): Promise<void> {
    if (this.loop === null) {
      this.loop = this.run().finally(() => {
        this.loop = null;
      });
    }
    return this.loop;
  }

  private async run(): Promise<void> {
    while (this.queue.length > 0 && this.options.now() >= this.pausedUntil) {
      const batch = this.takeBatch(MAX_BODY_BYTES);
      if (batch.length === 0) {
        break;
      }
      await this.track(this.post(batch, false));
    }
    this.schedule(0);
  }

  private track(request: Promise<void>): Promise<void> {
    this.inFlight.add(request);
    return request.finally(() => this.inFlight.delete(request));
  }

  /** Takes up to 20 events that fit maxBytes, dropping expired ones first. */
  private takeBatch(maxBytes: number): Pending[] {
    const now = this.options.now();
    this.queue = this.queue.filter((pending) => {
      const expired =
        pending.attempts >= MAX_ATTEMPTS ||
        (pending.firstAttemptAt !== null &&
          now - pending.firstAttemptAt > MAX_RETRY_AGE_MS);
      if (expired) {
        this.options.debug(`event ${pending.event.eventId} dropped after retries`);
      }
      return !expired;
    });
    const batch: Pending[] = [];
    let bytes = ENVELOPE_OVERHEAD_BYTES;
    while (
      this.queue.length > 0 &&
      batch.length < LIMITS.eventsPerRequest &&
      bytes + this.queue[0].bytes <= maxBytes
    ) {
      const pending = this.queue.shift() as Pending;
      bytes += pending.bytes;
      batch.push(pending);
    }
    // One event larger than the budget still goes out on its own (outside an
    // unload), so it is not stuck at the head of the queue forever.
    if (batch.length === 0 && this.queue.length > 0 && maxBytes === MAX_BODY_BYTES) {
      batch.push(this.queue.shift() as Pending);
    }
    return batch;
  }

  private async post(batch: Pending[], keepalive: boolean): Promise<void> {
    const now = this.options.now();
    for (const pending of batch) {
      pending.attempts += 1;
      pending.firstAttemptAt ??= now;
    }
    const envelope: BrowserEventEnvelope = {
      ...this.options.envelope,
      sentAt: new Date(now).toISOString(),
      events: batch.map((pending) => pending.event),
    };
    let status: number;
    let retryAfter: string | null = null;
    try {
      const response = await this.options.fetch(this.options.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelope),
        keepalive,
      });
      status = response.status;
      retryAfter = response.headers.get("Retry-After");
    } catch {
      // A network failure is the one ambiguous outcome: retry with backoff.
      this.requeue(batch);
      const attempts = Math.max(...batch.map((pending) => pending.attempts));
      this.pause(Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS));
      return;
    }
    if (status === 429 || status === 503) {
      this.requeue(batch);
      this.pause(parseRetryAfter(retryAfter, this.options.now()) ?? DEFAULT_RETRY_AFTER_MS[status]);
      return;
    }
    if (status < 200 || status >= 300) {
      this.options.debug(`request rejected with ${status}; ${batch.length} events dropped`);
    }
  }

  private requeue(batch: Pending[]): void {
    this.queue.unshift(...batch);
    this.queue.length = Math.min(this.queue.length, MAX_QUEUE);
  }

  private pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.options.now() + ms);
    this.cancelTimer();
    this.schedule(0);
  }
}

/** Seconds, or an HTTP date. Unreadable values fall back to the default. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function batchBytes(batch: Pending[]): number {
  return batch.reduce((total, pending) => total + pending.bytes, ENVELOPE_OVERHEAD_BYTES);
}

function byteLength(value: string): number {
  return typeof TextEncoder === "undefined"
    ? value.length * 3
    : new TextEncoder().encode(value).length;
}
