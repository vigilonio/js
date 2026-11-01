import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportReactError } from "./report";

export interface FallbackProps {
  error: unknown;
  componentStack: string | null;
  /** The Vigilon event ID, or null when the error was not sent. */
  eventId: string | null;
  /** Clears the error and renders the children again. */
  resetError: () => void;
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Rendered in place of the children after an error. Defaults to nothing. */
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  /** Called after the error is reported. */
  onError?: (error: unknown, componentStack: string | null, eventId: string | null) => void;
  /** Called when the fallback resets the boundary. */
  onReset?: (error: unknown) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
  componentStack: string | null;
  eventId: string | null;
}

const INITIAL_STATE: ErrorBoundaryState = {
  hasError: false,
  error: null,
  componentStack: null,
  eventId: null,
};

/**
 * Reports errors thrown while rendering its children, with their component
 * stack, and renders `fallback` instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack ?? null;
    const eventId = reportReactError(error, "react_error_boundary", true, componentStack);
    this.setState({ componentStack, eventId });
    this.props.onError?.(error, componentStack, eventId);
  }

  resetError = (): void => {
    const { error } = this.state;
    this.setState(INITIAL_STATE);
    this.props.onReset?.(error);
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const { fallback } = this.props;
    if (typeof fallback === "function") {
      return fallback({
        error: this.state.error,
        componentStack: this.state.componentStack,
        eventId: this.state.eventId,
        resetError: this.resetError,
      });
    }
    return fallback ?? null;
  }
}
