import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppErrorFallback } from "./AppErrorBoundary";

describe("AppErrorFallback", () => {
  it("offers a reload action and keeps the error message inspectable", () => {
    const markup = renderToStaticMarkup(
      <AppErrorFallback error={new Error("lazy module unavailable")} onReload={vi.fn()} />,
    );

    expect(markup).toContain("界面暂时无法继续显示");
    expect(markup).toContain("重新加载");
    expect(markup).toContain("lazy module unavailable");
    expect(markup).toContain("未保存的编辑内容可能会丢失");
  });
});
