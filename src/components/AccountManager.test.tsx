import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccountRecord } from "../types";
import { AccountManager } from "./AccountManager";

const account: AccountRecord = {
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
  createdAt: "2026-07-31T08:00:00.000Z",
  revision: 1,
  updatedAt: "2026-07-31T08:00:00.000Z",
  modifiedByDeviceId: "device-test",
};

describe("AccountManager", () => {
  it("keeps the delete action available when the service has one saved account", () => {
    const markup = renderToStaticMarkup(<AccountManager
      accounts={[account]}
      serviceId="service-office"
      serviceName="办公室"
      passwordTemplate=""
      initialAccountId={account.id}
      openMode="manage"
      onClose={vi.fn()}
      onSave={vi.fn()}
    />);

    expect(markup).toContain('title="删除账号"');
    expect(markup).not.toContain("至少保留一个账号");
  });
});
