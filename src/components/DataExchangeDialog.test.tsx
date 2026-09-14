import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DataExchangeDialog from "./DataExchangeDialog";

const props = {
  busyAction: null,
  result: "",
  error: "",
  onClose: vi.fn(),
  onBackup: vi.fn(),
  onImport: vi.fn(),
  onExportExcel: vi.fn(),
  onExportWord: vi.fn(),
};

describe("DataExchangeDialog", () => {
  it("shows the active action spinner without changing the other action labels", () => {
    const markup = renderToStaticMarkup(<DataExchangeDialog {...props} busyAction="excel" />);

    expect(markup).toContain("导出标准 Excel");
    expect(markup).toContain("导出只读 Word");
    expect(markup).toContain("创建加密备份");
    expect(markup).toContain("spin");
  });
});
