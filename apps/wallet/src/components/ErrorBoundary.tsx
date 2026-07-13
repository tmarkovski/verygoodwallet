/**
 * Last-resort error boundary around the routed pages.
 *
 * Remote issuers control JSON that flows into render (offer previews,
 * credential metadata) — without a boundary, one value React can't render
 * unmounts the entire root to a blank page. The boundary keeps the Shell
 * chrome alive, shows the error, and resets itself on navigation so "Back to
 * wallet" actually recovers.
 */

import { Component, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ErrorNote, describeError } from "./ui";

interface BoundaryProps {
  /** Changes on navigation; a pending error is cleared so the new page renders. */
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  error: string | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: describeError(error) };
  }

  override componentDidUpdate(prev: BoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="mx-auto max-w-sm animate-rise pt-16">
        <ErrorNote>This page hit an unexpected error: {this.state.error}</ErrorNote>
        <Link
          to="/"
          className="mt-5 inline-block text-sm text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
        >
          Back to wallet
        </Link>
      </div>
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Boundary resetKey={location.key}>{children}</Boundary>;
}
