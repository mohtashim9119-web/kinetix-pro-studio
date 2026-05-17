import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

/** Minimal panel fallback — keeps the rest of the UI alive. */
export function PanelFallback({
  label,
  error,
  reset,
}: {
  label: string;
  error: Error;
  reset: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <p className="text-sm font-semibold text-red-400">{label} crashed</p>
      <p className="text-xs text-gray-500">{error.message}</p>
      {import.meta.env.DEV && (
        <details className="text-left w-full max-w-sm">
          <summary className="text-xs text-gray-600 cursor-pointer">Stack trace</summary>
          <pre className="text-[10px] text-gray-700 mt-2 overflow-auto max-h-40 whitespace-pre-wrap">
            {error.stack}
          </pre>
        </details>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 text-xs font-bold bg-[#F27D26] text-black rounded-xl hover:bg-orange-400 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
