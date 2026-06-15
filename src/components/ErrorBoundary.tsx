import { Component, ErrorInfo, ReactNode } from "react";
import { debugLog } from "@/lib/debugLogger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    debugLog.error('ErrorBoundary', `💥 React crash: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" style={{
          padding: 32,
          fontFamily: 'system-ui, sans-serif',
          background: '#1a1a2e',
          color: '#e0e0e0',
          minHeight: '100vh',
        }}>
          <h1 style={{ color: '#ef4444', marginBottom: 16 }}>💥 שגיאה קריטית</h1>
          <p style={{ marginBottom: 12 }}>האפליקציה קרסה. הלוגים נשמרו ב-localStorage.</p>
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', color: '#60a5fa' }}>פרטי שגיאה</summary>
            <pre style={{
              background: '#0d0d1a',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              marginTop: 8,
              maxHeight: 300,
            }}>
              {this.state.error?.stack ?? this.state.error?.message}
            </pre>
          </details>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => {
                const text = debugLog.toText();
                navigator.clipboard.writeText(text);
                alert('הלוגים הועתקו!');
              }}
              style={{
                padding: '10px 20px',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              📋 העתק לוגים
            </button>
            <button
              onClick={() => location.reload()}
              style={{
                padding: '10px 20px',
                background: '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              🔄 רענן דף
            </button>
          </div>
          <h3 style={{ marginTop: 24, color: '#f59e0b' }}>לוגים אחרונים:</h3>
          <pre style={{
            background: '#0d0d1a',
            padding: 16,
            borderRadius: 8,
            overflow: 'auto',
            fontSize: 12,
            maxHeight: 400,
            whiteSpace: 'pre-wrap',
          }}>
            {debugLog.toText().split('\n').slice(-30).join('\n')}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
