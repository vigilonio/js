import { captureException } from "@vigilon/react";
import { useEffect } from "react";

/**
 * Reports the error an `error.tsx` or `global-error.tsx` boundary received.
 * Next.js creates the React root itself, so @vigilon/react's
 * rootErrorHandlers cannot be passed to it; this hook reports what those
 * boundaries catch instead.
 *
 * ```tsx
 * "use client";
 * export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
 *   useReportError(error);
 *   return <html><body><h2>Something went wrong.</h2></body></html>;
 * }
 * ```
 */
export function useReportError(error: unknown): void {
  useEffect(() => {
    captureException(error, { mechanism: "react_error_boundary", handled: true });
  }, [error]);
}
