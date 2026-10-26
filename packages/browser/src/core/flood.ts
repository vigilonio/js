import type { BrowserEvent } from "./envelope";

/**
 * Keeps an error loop from flooding ingestion: the same error is captured at
 * most once per window, and a page sends at most maxEventsPerPage events.
 */
export class FloodGuard {
  private readonly lastSeen = new Map<string, number>();
  private accepted = 0;

  constructor(
    private readonly maxEventsPerPage: number,
    private readonly duplicateWindowMs: number,
  ) {}

  admit(event: BrowserEvent, now: number): boolean {
    if (this.accepted >= this.maxEventsPerPage) {
      return false;
    }
    const { type, message, stack } = event.exception;
    const key = `${type}\n${message}\n${(stack ?? "").split("\n", 3).join("\n")}`;
    const previous = this.lastSeen.get(key);
    if (previous !== undefined && now - previous < this.duplicateWindowMs) {
      return false;
    }
    this.lastSeen.set(key, now);
    this.accepted += 1;
    return true;
  }
}
