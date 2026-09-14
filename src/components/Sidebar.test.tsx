import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryContextMenu } from "./Sidebar";

describe("CategoryContextMenu", () => {
  it("exposes menu semantics and keyboard-oriented items", () => {
    const markup = renderToStaticMarkup(
      <CategoryContextMenu
        contextMenu={{ x: 10, y: 20, category: { id: "category-1", name: "工作", parentId: null, color: "#123456", sortOrder: 0, revision: 0, updatedAt: "", modifiedByDeviceId: "" } }}
        mutationBusy={false}
        onClose={vi.fn()}
        onCreateCategory={vi.fn()}
        onRenameCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />,
    );

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('role="menuitem"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(3);
    expect(markup).toContain("工作 分类操作");
  });
});
