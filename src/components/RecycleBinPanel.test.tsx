import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecycleBinItem } from "../types";
import { RecycleBinPanel } from "./RecycleBinPanel";

const item: RecycleBinItem = {
  id: "trash-account",
  type: "account",
  label: "门禁密码",
  serviceName: "办公室",
  deletedAt: "2026-07-30T09:00:00.000Z",
  account: {
    id: "account-door",
    serviceId: "service-office",
    label: "门禁密码",
    username: "",
    password: "1234",
    identityCode: "",
    notes: [],
    visibleModules: ["password"],
    sortOrder: 0,
    securityQuestions: [],
    customFields: [],
    images: [],
    passwordHistory: [],
    createdAt: "2026-07-30T08:00:00.000Z",
    revision: 1,
    updatedAt: "2026-07-30T08:00:00.000Z",
    modifiedByDeviceId: "device-a",
  },
};

describe("RecycleBinPanel", () => {
  it("shows restore context and explicit permanent-delete actions", () => {
    const markup = renderToStaticMarkup(<RecycleBinPanel
      items={[item]}
      busyId={null}
      error=""
      onRestore={vi.fn()}
      onRequestDelete={vi.fn()}
      onRequestEmpty={vi.fn()}
    />);
    expect(markup).toContain("门禁密码");
    expect(markup).toContain("原分区：办公室");
    expect(markup).toContain('title="恢复账号“门禁密码”"');
    expect(markup).toContain('title="永久删除账号“门禁密码”"');
  });

  it("disables destructive actions while a restore is running", () => {
    const markup = renderToStaticMarkup(<RecycleBinPanel
      items={[item]}
      busyId={item.id}
      error=""
      onRestore={vi.fn()}
      onRequestDelete={vi.fn()}
      onRequestEmpty={vi.fn()}
    />);
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).toContain("spin");
  });

  it("renders an unambiguous empty state", () => {
    const markup = renderToStaticMarkup(<RecycleBinPanel
      items={[]}
      busyId={null}
      error=""
      onRestore={vi.fn()}
      onRequestDelete={vi.fn()}
      onRequestEmpty={vi.fn()}
    />);
    expect(markup).toContain("回收站是空的");
    expect(markup).toContain('disabled=""');
  });
});
