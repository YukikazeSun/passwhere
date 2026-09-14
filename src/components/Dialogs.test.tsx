import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DataExchangeDialog from "./DataExchangeDialog";
import { PasswordDecision } from "./Dialogs";
import { BackupCredentialDialog, BackupExportCredentialDialog } from "./ImportDialogs";
import { Modal, UnsavedChangesDialog } from "./Modal";

const handlers = {
  onClose: vi.fn(),
  onBackup: vi.fn(),
  onImport: vi.fn(),
  onExportExcel: vi.fn(),
  onExportWord: vi.fn(),
};

describe("DataExchangeDialog", () => {
  it("locks every action and close control while an exchange is running", () => {
    const markup = renderToStaticMarkup(
      <DataExchangeDialog busyAction="backup" result="" error="" {...handlers} />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(6);
    expect(markup).toContain('title="关闭" disabled=""');
    expect(markup).toContain('class="button button--secondary" disabled="">关闭</button>');
  });

  it("keeps actions available while idle", () => {
    const markup = renderToStaticMarkup(
      <DataExchangeDialog busyAction={null} result="" error="" {...handlers} />,
    );

    expect(markup).not.toContain('disabled=""');
  });
});

describe("backup export credentials", () => {
  it("explains that the standalone password is not stored locally", () => {
    const markup = renderToStaticMarkup(
      <BackupExportCredentialDialog onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(markup).toContain("导出文件需要单独的密码保护");
    expect(markup).toContain("备份密码不会保存到本机配置");
  });

  it("uses backup-password wording for portable export imports", () => {
    const markup = renderToStaticMarkup(
      <BackupCredentialDialog kind="export" onClose={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(markup).toContain("输入创建导出备份时设置的独立密码");
    expect(markup).toContain("<span>备份密码</span>");
  });
});

describe("editor save feedback", () => {
  it("connects modal headings and descriptions for assistive navigation", () => {
    const markup = renderToStaticMarkup(
      <Modal title="编辑记录" subtitle="修改当前内容" onClose={vi.fn()}><button>保存</button></Modal>,
    );

    expect(markup).toContain('role="dialog" aria-modal="true" aria-labelledby=');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).not.toContain('aria-label="编辑记录"');
  });

  it("locks password decisions while the final save is running", () => {
    const markup = renderToStaticMarkup(
      <PasswordDecision
        accountLabel="主账号"
        oldPassword="old"
        newPassword="new"
        busy
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(4);
    expect(markup).toContain("更新并保留旧密码");
    expect(markup).toContain("spin");
  });

  it("keeps the draft-preservation error visible in the unsaved dialog", () => {
    const markup = renderToStaticMarkup(
      <UnsavedChangesDialog
        canSave
        saving={false}
        saveError="保存失败，当前草稿仍保留"
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("保存失败，当前草稿仍保留");
  });
});
