import { act, Component, type ReactNode, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary, rootErrorHandlers } from "../index";

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn((_error: unknown, _context?: unknown) => "event-1"),
}));
vi.mock("@vigilon/browser", () => ({ captureException }));

// React logs caught and uncaught errors; the tests assert on reports instead.
let consoleError: ReturnType<typeof vi.spyOn>;
let root: Root | null = null;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.append(container);
  captureException.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  consoleError.mockRestore();
});

function render(ui: ReactNode, options?: Parameters<typeof createRoot>[1]) {
  root = createRoot(container, options);
  act(() => root?.render(ui));
}

function Thrower({ error }: { error: unknown }): ReactNode {
  throw error;
}

describe("ErrorBoundary", () => {
  it("reports the error with its component stack and renders the fallback", () => {
    const error = new Error("render failed");
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<p>Something went wrong</p>} onError={onError}>
        <Thrower error={error} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toBe("Something went wrong");
    expect(captureException).toHaveBeenCalledTimes(1);
    const [reported, context] = captureException.mock.calls[0] ?? [];
    expect(reported).toBe(error);
    expect(context).toMatchObject({ mechanism: "react_error_boundary", handled: true });
    expect((context as { componentStack: string }).componentStack).toContain("Thrower");
    expect(onError).toHaveBeenCalledWith(error, expect.stringContaining("Thrower"), "event-1");
  });

  it("passes the error, event ID, and a reset to a fallback function", () => {
    let shouldThrow = true;
    function Flaky(): ReactNode {
      if (shouldThrow) throw new Error("flaky");
      return <p>recovered</p>;
    }
    let reset: () => void = () => undefined;
    const onReset = vi.fn();
    render(
      <ErrorBoundary
        onReset={onReset}
        fallback={({ error, eventId, resetError }) => {
          reset = resetError;
          return <p>{`${(error as Error).message} ${eventId}`}</p>;
        }}
      >
        <Flaky />
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe("flaky event-1");

    shouldThrow = false;
    act(() => reset());
    expect(container.textContent).toBe("recovered");
    expect(onReset).toHaveBeenCalledWith(expect.objectContaining({ message: "flaky" }));
  });

  it("renders nothing without a fallback", () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error("quiet")} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("rootErrorHandlers", () => {
  it("reports an uncaught render error once, as react_uncaught, then calls your callback", async () => {
    const onUncaughtError = vi.fn();
    const error = new Error("uncaught");
    // act re-throws uncaught render errors without calling onUncaughtError,
    // so this render runs the way an app's does, outside act.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    root = createRoot(container, rootErrorHandlers({ onUncaughtError }));
    root.render(<Thrower error={error} />);
    await vi.waitFor(() => expect(onUncaughtError).toHaveBeenCalled());

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[0]).toBe(error);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      mechanism: "react_uncaught",
      handled: false,
    });
    expect(onUncaughtError).toHaveBeenCalledWith(error, expect.anything());
  });

  it("reports an error its boundary caught once, and still gives the fallback its event ID", () => {
    const error = new Error("caught");
    render(
      <StrictMode>
        <ErrorBoundary fallback={({ eventId }) => <p>{`fallback ${eventId}`}</p>}>
          <Thrower error={error} />
        </ErrorBoundary>
      </StrictMode>,
      rootErrorHandlers(),
    );

    // The root handler reports first; the boundary gets the same event ID.
    expect(container.textContent).toBe("fallback event-1");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      mechanism: "react_error_boundary",
      handled: true,
    });
  });

  it("reports errors another library's boundary caught", () => {
    class OtherBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    render(
      <OtherBoundary>
        <Thrower error={new Error("theirs")} />
      </OtherBoundary>,
      rootErrorHandlers(),
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      mechanism: "react_error_boundary",
    });
    // Without a callback the handler logs, as React would have.
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "theirs" }));
  });

  it("reports recoverable errors as react_recoverable", () => {
    const handlers = rootErrorHandlers();
    handlers.onRecoverableError(new Error("hydration mismatch"), { componentStack: "\n    at App" });
    expect(captureException.mock.calls[0]?.[1]).toEqual({
      mechanism: "react_recoverable",
      handled: true,
      componentStack: "\n    at App",
    });
  });

  it("reports a thrown non-object every time, since it cannot be told apart", () => {
    const handlers = rootErrorHandlers();
    handlers.onCaughtError("plain string", {});
    handlers.onCaughtError("plain string", {});
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
