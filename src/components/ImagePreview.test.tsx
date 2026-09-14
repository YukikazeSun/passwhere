import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImagePreview } from "./ImagePreview";

describe("ImagePreview", () => {
  it("exposes a labelled modal and an explicit close control", () => {
    const markup = renderToStaticMarkup(<ImagePreview url="data:image/png;base64,AA==" name="安全码" onClose={vi.fn()} />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("aria-labelledby=");
    expect(markup).toContain('aria-label="关闭图片预览"');
    expect(markup).toContain('tabindex="-1"');
  });
});
