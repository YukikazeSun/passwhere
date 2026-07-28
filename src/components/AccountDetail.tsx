import { useState, type CSSProperties } from "react";
import {
  Check,
  Clock3,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileKey2,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Plus,
  ShieldQuestion,
  UserRound,
} from "lucide-react";
import type { AccountRecord, Id, ServiceRecord, Tag } from "../types";
import { formatDateTime, splitLinks } from "../lib/utils";
import { IconAvatar } from "./IconAvatar";

interface AccountDetailProps {
  service: ServiceRecord;
  accounts: AccountRecord[];
  tags: Tag[];
  selectedAccountId: Id | null;
  onSelectAccount: (id: Id) => void;
  onAddAccount: () => void;
  onEditAccount: (account: AccountRecord) => void;
  onEditService: () => void;
  onOpenUrl: (url: string) => void;
  onCopy: (value: string, label: string) => void;
  onPreviewImage: (url: string, name: string) => void;
}

export function AccountDetail({
  service,
  accounts,
  tags,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
  onEditAccount,
  onEditService,
  onOpenUrl,
  onCopy,
  onPreviewImage,
}: AccountDetailProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const account = accounts.find((item) => item.id === selectedAccountId) || accounts[0];
  const tagIndex = new Map(tags.map((tag) => [tag.id, tag]));

  return (
    <main className="detail-pane">
      <header className="detail-header">
        <div className="detail-title">
          <IconAvatar name={service.name} image={service.icon} size="large" />
          <div>
            <div className="detail-title__name">
              <h1>{service.name}</h1>
              <button className="icon-button icon-button--small" onClick={onEditService} title="编辑分区">
                <Edit3 size={15} />
              </button>
            </div>
            <div className="detail-title__meta">
              {service.tagIds.map((tagId) => {
                const tag = tagIndex.get(tagId);
                return tag ? (
                  <span key={tag.id} className="tag-chip" style={{ "--tag-color": tag.color } as CSSProperties}>
                    <span />{tag.name}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        </div>
        <button className="button button--primary" onClick={() => onOpenUrl(service.url)} disabled={!service.url}>
          <ExternalLink size={16} /> 打开登录页
        </button>
      </header>

      <div className="account-tabs" role="tablist" aria-label="账号">
        {accounts.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={item.id === account?.id}
            className={item.id === account?.id ? "is-active" : ""}
            onClick={() => {
              setShowPassword(false);
              setShowHistory(false);
              onSelectAccount(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
        <button className="account-tabs__add" onClick={onAddAccount} title="新增账号">
          <Plus size={16} />
        </button>
      </div>

      {account ? (
        <div className="detail-scroll">
          <div className="account-toolbar">
            <div>
              <strong>{account.label}</strong>
              <span>最后修改 {formatDateTime(account.updatedAt)}</span>
            </div>
            <div className="toolbar-actions">
              <button className="button button--secondary" onClick={() => onEditAccount(account)}>
                <Edit3 size={15} /> 管理账号
              </button>
            </div>
          </div>

          {account.visibleModules.some((module) => ["username", "password", "identity"].includes(module)) ? <section className="detail-section">
            <div className="detail-section__heading">
              <UserRound size={18} />
              <h2>登录信息</h2>
            </div>
            <div className="credential-grid">
              {account.visibleModules.includes("username") ? <FieldRow label="账号" value={account.username} onCopy={() => onCopy(account.username, "账号")} /> : null}
              {account.visibleModules.includes("password") ? <div className="field-row">
                <span className="field-label">当前密码</span>
                <code className="password-value">{showPassword ? account.password : "••••••••••••"}</code>
                <span className="field-actions">
                  <button className="icon-button icon-button--small" onClick={() => setShowPassword((value) => !value)} title={showPassword ? "隐藏密码" : "显示密码"}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button className="icon-button icon-button--small" onClick={() => onCopy(account.password, "密码")} title="复制密码">
                    <Copy size={16} />
                  </button>
                </span>
              </div> : null}
              {account.visibleModules.includes("identity") && account.identityCode ? (
                <FieldRow label="身份识别码" value={account.identityCode} multiline onCopy={() => onCopy(account.identityCode, "身份识别码")} />
              ) : null}
            </div>
            {account.visibleModules.includes("password") && account.passwordHistory.length > 0 ? (
              <div className="history-block">
                <button className="history-toggle" onClick={() => setShowHistory((value) => !value)}>
                  <Clock3 size={15} /> 历史密码 {account.passwordHistory.length} 条
                  <span>{showHistory ? "收起" : "查看"}</span>
                </button>
                {showHistory ? (
                  <div className="history-list">
                    {account.passwordHistory.map((item) => (
                      <div key={item.id}>
                        <code>{item.password}</code>
                        <span>{formatDateTime(item.changedAt)}</span>
                        <button className="icon-button icon-button--small" onClick={() => onCopy(item.password, "历史密码")} title="复制历史密码">
                          <Copy size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section> : null}

          {account.visibleModules.includes("security") && account.securityQuestions.length > 0 ? (
            <section className="detail-section">
              <div className="detail-section__heading">
                <ShieldQuestion size={18} />
                <h2>密保问题</h2>
              </div>
              <div className="qa-list">
                {account.securityQuestions.map((item) => (
                  <div key={item.id} className="qa-row">
                    <span><small>问题</small>{item.question}</span>
                    <span><small>回答</small>{item.answer}</span>
                    <button className="icon-button icon-button--small" onClick={() => onCopy(item.answer, "密保回答")} title="复制回答">
                      <Copy size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {account.visibleModules.includes("custom") && account.customFields.length > 0 ? (
            <section className="detail-section">
              <div className="detail-section__heading">
                <FileKey2 size={18} />
                <h2>自定义信息</h2>
              </div>
              <div className="custom-field-grid">
                {account.customFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    label={field.label || "未命名字段"}
                    value={field.value}
                    multiline={field.multiline}
                    onCopy={field.copyable ? () => onCopy(field.value, field.label) : undefined}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {account.visibleModules.includes("notes") && account.notes.length > 0 ? (
            <section className="detail-section">
              <div className="detail-section__heading">
                <Link2 size={18} />
                <h2>备注</h2>
              </div>
              <div className="note-detail-list">{account.notes.map((note) => <article key={note.id}><strong>{note.title || "备注"}</strong><p className="notes-text">{splitLinks(note.content).map((part, index) => part.isUrl ? <button key={`${part.text}-${index}`} onClick={() => onOpenUrl(part.text)}>{part.text}</button> : <span key={`${part.text}-${index}`}>{part.text}</span>)}</p></article>)}</div>
            </section>
          ) : null}

          {account.visibleModules.includes("images") ? <section className="detail-section">
            <div className="detail-section__heading">
              <ImageIcon size={18} />
              <h2>图片</h2>
              <span>{account.images.length} 张</span>
            </div>
            {account.images.length > 0 ? (
              <div className="image-gallery">
                {account.images.map((image) => (
                  <button key={image.id} onClick={() => onPreviewImage(image.dataUrl || image.sourceUrl || "", image.name)}>
                    <img src={image.dataUrl || image.sourceUrl} alt={image.name} />
                    <span>{image.name}</span>
                    {image.sourceUrl ? <Link2 size={13} /> : <Check size={13} />}
                  </button>
                ))}
              </div>
            ) : (
              <button className="empty-images" onClick={() => onEditAccount(account)}>
                <ImageIcon size={22} />
                <span>还没有图片</span>
                <small>编辑账号后可粘贴截图或图片网址</small>
              </button>
            )}
          </section> : null}
        </div>
      ) : (
        <div className="empty-detail">
          <KeyRound size={28} />
          <strong>此分区还没有账号</strong>
          <button className="button button--primary" onClick={onAddAccount}><Plus size={16} /> 新增账号</button>
        </div>
      )}
    </main>
  );
}

function FieldRow({ label, value, multiline = false, onCopy }: { label: string; value: string; multiline?: boolean; onCopy?: () => void }) {
  return (
    <div className={`field-row ${multiline ? "field-row--multiline" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="field-value">{value || "—"}</span>
      {onCopy ? (
        <button className="icon-button icon-button--small" onClick={onCopy} title={`复制${label}`}>
          <Copy size={16} />
        </button>
      ) : null}
    </div>
  );
}
