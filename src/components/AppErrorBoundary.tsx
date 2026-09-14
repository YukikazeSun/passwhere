import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RefreshCcw } from "lucide-react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export function AppErrorFallback({ error, onReload }: { error: Error; onReload: () => void }) {
  return (
    <main className="fatal-error-screen" role="alert">
      <section className="fatal-error-panel">
        <CircleAlert size={30} aria-hidden="true" />
        <div className="fatal-error-copy">
          <strong>界面暂时无法继续显示</strong>
          <p>已保存的本地数据不会被此页面清除；未保存的编辑内容可能会丢失。</p>
        </div>
        <button type="button" className="button button--primary" onClick={onReload}>
          <RefreshCcw size={15} />重新加载
        </button>
        <details>
          <summary>查看错误详情</summary>
          <code>{error.message || error.name}</code>
        </details>
      </section>
    </main>
  );
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
