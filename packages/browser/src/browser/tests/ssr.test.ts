// @vitest-environment node
import { describe, expect, it } from "vitest";
import { captureException, close, flush, init, setTag, setUser } from "../../index";

describe("@vigilon/browser during SSR", () => {
  it("imports and runs as a no-op without window or document", async () => {
    expect(typeof window).toBe("undefined");
    expect(
      init({ apiKey: "k", serviceName: "web", environment: "test", serviceVersion: "1" }),
    ).toBe(false);
    expect(captureException(new Error("server"))).toBeNull();
    setUser({ id: "u" });
    setTag("a", "b");
    expect(await flush()).toBe(true);
    expect(await close()).toBe(true);
  });
});
