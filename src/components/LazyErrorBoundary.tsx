import { Component, ErrorInfo, ReactNode } from "react";
import { debugLog } from "@/lib/debugLogger";

interface Props {
  children: ReactNode;
  /** Label shown in error UI to identify which section crashed */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary for lazy-loaded sections.
 * Shows an inline recovery UI instead of crashing the whole page.
 */
export class LazyErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    debugLog.error('LazyErrorBoundary', `💥 Section "${this.props.label || 'unknown'}" crashed: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center space-y-2">
          <p className="text-sm text-destructive font-medium">
            שגיאה ב{this.props.label || 'רכיב'}
          </p>
          <p className="text-xs text-muted-foreground">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
