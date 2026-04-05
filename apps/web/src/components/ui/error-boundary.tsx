import React, { type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Rendered when the subtree throws. Receives the error and a reset callback. */
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Optional context tag for the console warning (e.g. "MessagesTimeline"). */
  context?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic error boundary for isolating render failures.
 *
 * Catches errors in child component trees so the rest of the app stays
 * functional. Logs a warning with optional context.
 */
export class ComponentErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown) {
    const tag = this.props.context ?? "ComponentErrorBoundary";
    console.warn(`[t3code] ${tag}: render error caught`, error);
  }

  reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        return fallback(this.state.error, this.reset);
      }
      return fallback;
    }
    return this.props.children;
  }
}
