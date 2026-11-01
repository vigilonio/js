import type { SpanProcessorContext } from "@vigilon/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRouteSpanProcessor } from "../nextRouteSpanProcessor";
import { register } from "../register";
import { VercelFlushSpanProcessor } from "../vercelFlushSpanProcessor";
import { VercelResponseStatusProcessor } from "../vercelResponseStatusProcessor";

// The composition is under test, not the SDK start: @vigilon/node is mocked
// and the extendSpanProcessors callback it receives is inspected.
const { registerNode } = vi.hoisted(() => ({ registerNode: vi.fn() }));
vi.mock("@vigilon/node", () => ({ register: registerNode }));

const params = { apiKey: "test-key", serviceName: "test-service", environment: "test" };
const fakeContext = {
  batchSpanProcessor: { forceFlush: vi.fn() },
} as unknown as SpanProcessorContext;

const NODE_REGISTER_STATE_KEY = Symbol.for("vigilon.register.started");
const NEXTJS_REGISTER_STATE_KEY = Symbol.for("vigilon.register.nextjs");
const originalVercel = process.env.VERCEL;
const globalState = globalThis as Record<symbol, unknown>;

function clearRegisterState(): void {
  delete globalState[NODE_REGISTER_STATE_KEY];
  delete globalState[NEXTJS_REGISTER_STATE_KEY];
}

function extensions() {
  const { extendSpanProcessors } = registerNode.mock.calls[0]?.[0] ?? {};
  return extendSpanProcessors(fakeContext);
}

beforeEach(() => {
  registerNode.mockClear();
  delete process.env.VERCEL;
  clearRegisterState();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearRegisterState();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe("register", () => {
  it("forwards its params to @vigilon/node with an extension callback", () => {
    register(params);
    expect(registerNode).toHaveBeenCalledTimes(1);
    const forwarded = registerNode.mock.calls[0]?.[0];
    expect(forwarded).toMatchObject(params);
    expect(typeof forwarded.extendSpanProcessors).toBe("function");
  });

  it("works with no params, leaving resolution to @vigilon/node", () => {
    register();
    expect(registerNode.mock.calls[0]?.[0]).toEqual({
      extendSpanProcessors: expect.any(Function),
    });
  });

  it("prepends the route processor and appends nothing off Vercel", () => {
    register(params);
    const { prepend, append } = extensions();
    expect(prepend).toHaveLength(1);
    expect(prepend[0]).toBeInstanceOf(NextRouteSpanProcessor);
    expect(append).toHaveLength(0);
  });

  it("appends the Vercel flush and response status processors on Vercel", () => {
    process.env.VERCEL = "1";
    register(params);
    const { append } = extensions();
    expect(append).toHaveLength(2);
    expect(append[0]).toBeInstanceOf(VercelFlushSpanProcessor);
    expect(append[1]).toBeInstanceOf(VercelResponseStatusProcessor);
  });
});

describe("a plain @vigilon/node start", () => {
  it("is detected: register warns and does nothing", () => {
    globalState[NODE_REGISTER_STATE_KEY] = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(register(params)).toBeUndefined();
    expect(registerNode).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("@vigilon/nextjs/register"));
  });

  it("is told apart from a second call of this register, which @vigilon/node's guard handles", () => {
    register(params);
    expect(globalState[NEXTJS_REGISTER_STATE_KEY]).toBe(true);
    globalState[NODE_REGISTER_STATE_KEY] = true;
    registerNode.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    register(params);

    expect(registerNode).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("not active"));
  });
});
