import { useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent, type FormEvent } from "react";
import {
  Check,
  Copy,
  Crop,
  Eye,
  GripVertical,
  ImagePlus,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  AccountDisplayModule,
  AccountNote,
  AccountRecord,
  CustomField,
  Id,
  SecurityQuestion,
  StoredImage,
} from "../types";
import { ALL_ACCOUNT_MODULES, moveItem, sortByOrder, withSortOrder } from "../lib/dataModel";
import { fetchRemoteImage, isImageFile, readFileAsDataUrl } from "../lib/storage";
import { useUnsavedChanges } from "../lib/useUnsavedChanges";
import { useAsyncEditorSave, type EditorSaveResult } from "../lib/useAsyncEditorSave";
import { applyPasswordTemplate, isPasswordTemplateConfigured } from "../lib/passwordTemplate";
import { createId, nowIso, validateExternalUrl } from "../lib/utils";
import { Modal, UnsavedChangesDialog } from "./Modal";
import ImageCropDialog from "./ImageCropDialog";

const MODULE_LABELS: Record<AccountDisplayModule, string> = {
  username: "登录账号",
  password: "密码",
  identity: "身份识别码",
  securityPhone: "密保手机",
  securityEmail: "密保邮箱",
  security: "密保问题",
  custom: "自定义字段",
  notes: "备注",
  images: "图片",
};

function createAccount(serviceId: Id, sortOrder: number): AccountRecord {
  const timestamp = nowIso();
  return {
    id: createId("account"), serviceId, label: "新账号", username: "", password: "", identityCode: "",
    securityPhone: "", securityEmail: "",
    notes: [], visibleModules: ["username", "password"], sortOrder, securityQuestions: [], customFields: [],
    images: [], passwordHistory: [], createdAt: timestamp, updatedAt: timestamp,
    revision: 0, modifiedByDeviceId: "",
  };
}

export function AccountManager({
  accounts,
  serviceId,
  serviceName,
  passwordTemplate,
  initialAccountId,
  openMode,
  onClose,
  onSave,
}: {
  accounts: AccountRecord[];
  serviceId: Id;
  serviceName: string;
  passwordTemplate: string;
  initialAccountId: Id | null;
  openMode: "create" | "manage";
  onClose: () => void;
  onSave: (accounts: AccountRecord[]) => Promise<EditorSaveResult>;
}) {
  const [initialState] = useState(() => {
    const ordered = sortByOrder(accounts);
    const initialDrafts = ordered.length ? ordered : [createAccount(serviceId, 0)];
    if (openMode === "create" && ordered.length > 0) {
      const created = createAccount(serviceId, initialDrafts.length);
      return { initialDrafts, drafts: [...initialDrafts, created], selectedId: created.id };
    }
    const selectedId = initialAccountId && initialDrafts.some((item) => item.id === initialAccountId)
      ? initialAccountId
      : initialDrafts[0]?.id || "";
    return { initialDrafts, drafts: initialDrafts, selectedId };
  });
  const initialDrafts = initialState.initialDrafts;
  const [drafts, setDrafts] = useState<AccountRecord[]>(initialState.drafts);
  const [selectedId, setSelectedId] = useState(initialState.selectedId);
  const [pendingDelete, setPendingDelete] = useState<AccountRecord | null>(null);
  const [templateTarget, setTemplateTarget] = useState<{ accountId: Id; websiteName: string } | null>(null);
  const [draggedId, setDraggedId] = useState<Id | null>(null);
  const [cropTarget, setCropTarget] = useState<StoredImage | null>(null);
  const [imageImportError, setImageImportError] = useState("");
  const isDirty = drafts !== initialDrafts;
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const { saving, saveError, runSave } = useAsyncEditorSave(onClose);
  const selected = drafts.find((item) => item.id === selectedId) || drafts[0];

  const updateSelected = (update: (account: AccountRecord) => AccountRecord) => {
    if (!selected) return;
    setDrafts((current) => current.map((account) => account.id === selected.id ? update(account) : account));
  };

  const addAccount = () => {
    const account = createAccount(serviceId, drafts.length);
    setDrafts((current) => [...current, account]);
    setSelectedId(account.id);
  };

  const deleteAccount = () => {
    if (!pendingDelete) return;
    const index = drafts.findIndex((item) => item.id === pendingDelete.id);
    const next = withSortOrder(drafts.filter((item) => item.id !== pendingDelete.id));
    setDrafts(next);
    if (selectedId === pendingDelete.id) setSelectedId(next[Math.min(index, next.length - 1)]?.id || "");
    setPendingDelete(null);
  };

  const moveAccount = (targetId: Id, sourceId = draggedId) => {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = drafts.findIndex((item) => item.id === sourceId);
    const targetIndex = drafts.findIndex((item) => item.id === targetId);
    setDrafts(withSortOrder(moveItem(drafts, sourceIndex, targetIndex)));
    setDraggedId(null);
  };

  const canSave = drafts.every((account) => account.label.trim());
  const saveDrafts = () => {
    if (drafts.some((account) => !account.label.trim())) return;
    const timestamp = nowIso();
    void runSave(() => onSave(withSortOrder(drafts).map((account) => ({ ...account, label: account.label.trim(), updatedAt: timestamp }))));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDrafts();
  };

  const applyTemplate = () => {
    if (!templateTarget) return;
    const generated = applyPasswordTemplate(passwordTemplate, templateTarget.websiteName.trim());
    setDrafts((current) => current.map((account) => account.id === templateTarget.accountId ? { ...account, password: generated } : account));
    setTemplateTarget(null);
  };

  return (
    <>
      <Modal title="管理账号" subtitle="左侧清单与详情页分页同步；拖动手柄可调整顺序" onClose={unsaved.requestClose} width="wide" closeDisabled={saving}>
        <form onSubmit={submit} aria-busy={saving}>
          <div className={`modal-fields ${saving ? "is-disabled" : ""}`} aria-disabled={saving}>
          <div className="account-manager">
            <aside className="account-manager__list">
              <div className="account-manager__list-heading"><span>账号清单</span><button type="button" className="icon-button icon-button--small" onClick={addAccount} title="添加账号"><Plus size={15} /></button></div>
              <div className="account-manager__items">
                {drafts.map((account) => (
                  <div key={account.id} className={`account-manager__item ${account.id === selected?.id ? "is-active" : ""} ${draggedId === account.id ? "is-dragging" : ""}`} draggable onDragStart={(event) => { setDraggedId(account.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/account-notebook-account", account.id); event.dataTransfer.setData("text/plain", `account-notebook-account:${account.id}`); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("text/account-notebook-account") || event.dataTransfer.types.includes("text/plain")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const customSourceId = event.dataTransfer.getData("text/account-notebook-account"); const plainSource = event.dataTransfer.getData("text/plain"); const sourceId = customSourceId || (plainSource.startsWith("account-notebook-account:") ? plainSource.slice("account-notebook-account:".length) : "") || draggedId; if (sourceId && drafts.some((item) => item.id === sourceId)) moveAccount(account.id, sourceId); }} onDragEnd={() => setDraggedId(null)}>
                    <GripVertical size={15} aria-hidden="true" />
                    <button type="button" onClick={() => setSelectedId(account.id)}><strong>{account.label || "未命名账号"}</strong><span>{account.visibleModules.length} 个显示模块</span></button>
                    {accounts.some((item) => item.id === account.id) || drafts.length > 1
                      ? <button type="button" className="icon-button icon-button--small" onClick={() => setPendingDelete(account)} title="删除账号"><Trash2 size={14} /></button>
                      : <span aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </aside>
            <div className="account-manager__form" onPaste={(event) => void handlePaste(event, updateSelected, setImageImportError)}>
              {imageImportError ? <p className="form-error image-url-error" role="alert">{imageImportError}</p> : null}
              {selected ? <>
              <section className="editor-section account-primary-row">
                <label className="form-field"><span>账号名称 *</span><input autoFocus value={selected.label} onChange={(event) => updateSelected((account) => ({ ...account, label: event.target.value }))} placeholder="例如 主账号、门禁密码" /></label>
                <VisibilitySelector value={selected.visibleModules} onChange={(visibleModules) => updateSelected((account) => ({ ...account, visibleModules }))} />
              </section>
              {(selected.visibleModules.some((module) => ["username", "password", "identity", "securityPhone", "securityEmail"].includes(module))) ? (
                <section className="editor-section"><h3>基本信息</h3><div className="form-grid">
                  {selected.visibleModules.includes("username") ? <label className="form-field"><span>登录账号</span><input value={selected.username} onChange={(event) => updateSelected((account) => ({ ...account, username: event.target.value }))} /></label> : null}
                  {selected.visibleModules.includes("password") ? <div className="form-field"><span>当前密码</span><div className="password-template-input"><input value={selected.password} onChange={(event) => updateSelected((account) => ({ ...account, password: event.target.value }))} />{isPasswordTemplateConfigured(passwordTemplate) ? <button type="button" className="button button--secondary" onClick={() => setTemplateTarget({ accountId: selected.id, websiteName: serviceName })}><WandSparkles size={14} />使用模板</button> : null}</div></div> : null}
                  {selected.visibleModules.includes("identity") ? <label className="form-field form-field--wide"><span>身份识别码</span><textarea rows={2} value={selected.identityCode} onChange={(event) => updateSelected((account) => ({ ...account, identityCode: event.target.value }))} /></label> : null}
                  {selected.visibleModules.includes("securityPhone") ? <label className="form-field"><span>密保手机</span><input value={selected.securityPhone || ""} onChange={(event) => updateSelected((account) => ({ ...account, securityPhone: event.target.value }))} placeholder="例如 13800138000" /></label> : null}
                  {selected.visibleModules.includes("securityEmail") ? <label className="form-field"><span>密保邮箱</span><input type="email" value={selected.securityEmail || ""} onChange={(event) => updateSelected((account) => ({ ...account, securityEmail: event.target.value }))} placeholder="例如 security@example.com" /></label> : null}
                </div></section>
              ) : null}
              {selected.visibleModules.includes("security") ? <SecurityEditor items={selected.securityQuestions} onChange={(securityQuestions) => updateSelected((account) => ({ ...account, securityQuestions }))} /> : null}
              {selected.visibleModules.includes("custom") ? <CustomFieldEditor items={selected.customFields} onChange={(customFields) => updateSelected((account) => ({ ...account, customFields }))} /> : null}
              {selected.visibleModules.includes("notes") ? <NoteEditor items={selected.notes} onChange={(notes) => updateSelected((account) => ({ ...account, notes }))} /> : null}
              {selected.visibleModules.includes("images") ? <ImageEditor key={selected.id} items={selected.images} onChange={(updateImages) => updateSelected((account) => ({ ...account, images: updateImages(account.images) }))} onCrop={(image) => setCropTarget(image)} /> : null}
              </> : <div className="account-manager__empty"><Trash2 size={24} /><strong>当前分区没有账号</strong><span>保存后，刚删除的账号会进入设置中的回收站。</span><button type="button" className="button button--secondary" onClick={addAccount}><Plus size={15} />添加账号</button></div>}
            </div>
          </div>
          </div>
          {saveError ? <p className="form-error modal-save-error" role="alert">{saveError}</p> : null}
          <footer className="modal-footer"><span>{drafts.length} 个账号</span><div><button type="button" className="button button--quiet" onClick={unsaved.requestClose} disabled={saving}>取消</button><button className="button button--primary" disabled={!canSave || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {saving ? "保存中" : "保存全部"}</button></div></footer>
        </form>
      </Modal>
      {pendingDelete ? <ConfirmDialog title="删除账号" message={`确定将“${pendingDelete.label}”移入回收站？保存后可在设置中恢复。`} onCancel={() => setPendingDelete(null)} onConfirm={deleteAccount} /> : null}
      {templateTarget ? <PasswordTemplateDialog
        account={drafts.find((account) => account.id === templateTarget.accountId)!}
        template={passwordTemplate}
        websiteName={templateTarget.websiteName}
        onWebsiteNameChange={(websiteName) => setTemplateTarget({ ...templateTarget, websiteName })}
        onCancel={() => setTemplateTarget(null)}
        onConfirm={applyTemplate}
      /> : null}
      {cropTarget ? <ImageCropDialog image={cropTarget} onCancel={() => setCropTarget(null)} onConfirm={(dataUrl) => { updateSelected((account) => ({ ...account, images: account.images.map((image) => image.id === cropTarget.id ? { ...image, dataUrl, sourceUrl: undefined } : image) })); setCropTarget(null); }} /> : null}
      {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={canSave} saving={saving} saveError={saveError} onSave={saveDrafts} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
    </>
  );
}

function PasswordTemplateDialog({ account, template, websiteName, onWebsiteNameChange, onCancel, onConfirm }: {
  account: AccountRecord;
  template: string;
  websiteName: string;
  onWebsiteNameChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const result = applyPasswordTemplate(template, websiteName.trim());
  const hasPassword = Boolean(account.password);
  const unchanged = account.password === result;
  return <Modal title="使用密码模板" subtitle={`填入“${account.label}”的当前密码`} onClose={onCancel} width="small">
    <div className="modal-body password-template-dialog">
      <label className="form-field"><span>网站名称</span><input autoFocus value={websiteName} onChange={(event) => onWebsiteNameChange(event.target.value)} placeholder="网站或软件名称" /></label>
      <div className="password-template-result"><span>生成结果 · {result.length} 字符</span><code>{result}</code></div>
      {hasPassword && !unchanged ? <p className="password-template-warning">当前账号已有密码，确认后将覆盖表单中的现有内容；保存账号时仍会询问是否保留旧密码。</p> : null}
    </div>
    <footer className="modal-footer"><span>{unchanged ? "当前密码已是此结果" : "仅填入当前草稿"}</span><div><button type="button" className="button button--quiet" onClick={onCancel}>取消</button><button type="button" className="button button--primary" onClick={onConfirm} disabled={!websiteName.trim() || unchanged}><WandSparkles size={15} />{hasPassword ? "覆盖当前密码" : "填入密码"}</button></div></footer>
  </Modal>;
}

function VisibilitySelector({ value, onChange }: { value: AccountDisplayModule[]; onChange: (value: AccountDisplayModule[]) => void }) {
  const visibleModules = ALL_ACCOUNT_MODULES.filter((module) => value.includes(module));
  const hiddenModules = ALL_ACCOUNT_MODULES.filter((module) => !value.includes(module));
  const hide = (module: AccountDisplayModule) => onChange(value.filter((item) => item !== module));
  const show = (module: AccountDisplayModule) => onChange(ALL_ACCOUNT_MODULES.filter((item) => item === module || value.includes(item)));

  return <fieldset className="visibility-selector">
    <legend><Eye size={14} /> 详情页内容</legend>
    <div className="visibility-selector__group">
      <span>正在显示</span>
      <div>{visibleModules.map((module) => <button type="button" className="visibility-chip is-visible" key={module} onClick={() => hide(module)} title={`隐藏${MODULE_LABELS[module]}`}><span>{MODULE_LABELS[module]}</span><X size={12} /></button>)}</div>
    </div>
    {hiddenModules.length ? <div className="visibility-selector__group">
      <span>添加内容</span>
      <div>{hiddenModules.map((module) => <button type="button" className="visibility-chip" key={module} onClick={() => show(module)} title={`添加${MODULE_LABELS[module]}`}><Plus size={12} /><span>{MODULE_LABELS[module]}</span></button>)}</div>
    </div> : null}
    <button type="button" className="visibility-selector__password-only" onClick={() => onChange(["password"])}>仅保留密码</button>
  </fieldset>;
}

function SecurityEditor({ items, onChange }: { items: SecurityQuestion[]; onChange: (items: SecurityQuestion[]) => void }) {
  return <section className="editor-section"><div className="editor-section__heading"><h3>密保问题</h3><button type="button" className="button button--quiet" onClick={() => onChange([...items, { id: createId("question"), question: "", answer: "" }])}><Plus size={14} /> 添加</button></div>{items.length ? <div className="repeater-list">{items.map((item, index) => <div key={item.id} className="repeater-row"><input aria-label={`密保问题 ${index + 1}`} value={item.question} placeholder="问题" onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, question: event.target.value } : entry))} /><input aria-label={`密保回答 ${index + 1}`} value={item.answer} placeholder="回答" onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, answer: event.target.value } : entry))} /><button type="button" className="icon-button icon-button--small" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} title="删除"><Trash2 size={15} /></button></div>)}</div> : <p className="editor-empty">没有密保问题</p>}</section>;
}

function CustomFieldEditor({ items, onChange }: { items: CustomField[]; onChange: (items: CustomField[]) => void }) {
  return <section className="editor-section"><div className="editor-section__heading"><h3>自定义字段</h3><button type="button" className="button button--quiet" onClick={() => onChange([...items, { id: createId("field"), label: "", value: "", multiline: false, copyable: true }])}><Plus size={14} /> 添加</button></div>{items.length ? <div className="repeater-list">{items.map((field, index) => <div key={field.id} className="custom-editor-row"><input aria-label={`字段名称 ${index + 1}`} value={field.label} placeholder="字段名称" onChange={(event) => onChange(items.map((entry) => entry.id === field.id ? { ...entry, label: event.target.value } : entry))} />{field.multiline ? <textarea rows={2} value={field.value} onChange={(event) => onChange(items.map((entry) => entry.id === field.id ? { ...entry, value: event.target.value } : entry))} /> : <input value={field.value} placeholder="字段内容" onChange={(event) => onChange(items.map((entry) => entry.id === field.id ? { ...entry, value: event.target.value } : entry))} />}<label className="compact-check"><input type="checkbox" checked={field.multiline} onChange={() => onChange(items.map((entry) => entry.id === field.id ? { ...entry, multiline: !entry.multiline } : entry))} />多行</label><label className="compact-check"><input type="checkbox" checked={field.copyable} onChange={() => onChange(items.map((entry) => entry.id === field.id ? { ...entry, copyable: !entry.copyable } : entry))} /><Copy size={13} /></label><button type="button" className="icon-button icon-button--small" onClick={() => onChange(items.filter((entry) => entry.id !== field.id))} title="删除"><Trash2 size={15} /></button></div>)}</div> : <p className="editor-empty">可记录恢复码、许可证等信息</p>}</section>;
}

function NoteEditor({ items, onChange }: { items: AccountNote[]; onChange: (items: AccountNote[]) => void }) {
  return <section className="editor-section"><div className="editor-section__heading"><div><h3>备注条目</h3><p>每条备注可独立命名；网址会在详情页转为链接</p></div><button type="button" className="button button--quiet" onClick={() => onChange([...items, { id: createId("note"), title: "新备注", content: "" }])}><Plus size={14} /> 添加条目</button></div>{items.length ? <div className="note-editor-list">{items.map((note, index) => <div key={note.id}><input aria-label={`备注名称 ${index + 1}`} value={note.title} placeholder="条目名称" onChange={(event) => onChange(items.map((entry) => entry.id === note.id ? { ...entry, title: event.target.value } : entry))} /><textarea aria-label={`备注内容 ${index + 1}`} rows={3} value={note.content} placeholder="备注内容" onChange={(event) => onChange(items.map((entry) => entry.id === note.id ? { ...entry, content: event.target.value } : entry))} /><button type="button" className="icon-button icon-button--small" onClick={() => onChange(items.filter((entry) => entry.id !== note.id))} title="删除备注"><Trash2 size={15} /></button></div>)}</div> : <p className="editor-empty">还没有备注条目</p>}</section>;
}

function ImageEditor({ items, onChange, onCrop }: { items: StoredImage[]; onChange: (update: (current: StoredImage[]) => StoredImage[]) => void; onCrop: (image: StoredImage) => void }) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const normalizedImageUrl = imageUrl.trim();
  const imageUrlValid = validateExternalUrl(normalizedImageUrl);
  const addFiles = async (files: FileList | File[]) => {
    const selectedFiles = [...files];
    const imageFiles = selectedFiles.filter(isImageFile);
    if (selectedFiles.length > 0 && imageFiles.length === 0) {
      setImageError("请选择 PNG、JPEG、WebP、GIF、BMP 或 ICO 图片");
      return;
    }
    setImageError("");
    try {
      const additions = await Promise.all(imageFiles.map(async (file) => ({ id: createId("image"), name: file.name || "粘贴图片", dataUrl: await readFileAsDataUrl(file) })));
      onChange((current) => [...current, ...additions]);
    } catch (reason) {
      setImageError(`图片添加失败：${String(reason)}`);
    }
  };
  const addRemote = async () => {
    if (!imageUrlValid) {
      setImageError("请输入以 http:// 或 https:// 开头的有效图片网址");
      return;
    }
    setLoading(true);
    setImageError("");
    try {
      const dataUrl = await fetchRemoteImage(normalizedImageUrl);
      onChange((current) => [...current, { id: createId("image"), name: new URL(normalizedImageUrl).pathname.split("/").pop() || "网络图片", dataUrl, sourceUrl: normalizedImageUrl }]);
      setImageUrl("");
    } catch (reason) {
      setImageError(`图片加载失败：${String(reason)}`);
    } finally {
      setLoading(false);
    }
  };
  const onDrop = (event: DragEvent) => { event.preventDefault(); void addFiles(event.dataTransfer.files); };
  return <section className="editor-section"><div className="editor-section__heading"><div><h3>图片</h3><p>支持文件拖放、粘贴截图和图片网址；可等比裁切</p></div><input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.ico" multiple hidden onChange={(event) => event.target.files && void addFiles(event.target.files)} /><button type="button" className="button button--secondary" onClick={() => input.current?.click()}><Upload size={14} /> 选择图片</button></div><div className="image-url-row"><div className="input-with-icon"><Link2 size={15} /><input value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setImageError(""); }} placeholder="粘贴图片网址" aria-invalid={Boolean(normalizedImageUrl && !imageUrlValid)} /></div><button type="button" className="button button--quiet" onClick={() => void addRemote()} disabled={loading || !imageUrlValid}>{loading ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} 添加</button></div>{normalizedImageUrl && !imageUrlValid ? <p className="form-error image-url-error" role="alert">请输入以 http:// 或 https:// 开头的有效图片网址</p> : imageError ? <p className="form-error image-url-error" role="alert">{imageError}</p> : null}{items.length ? <div className="image-editor-grid">{items.map((image) => <div key={image.id}><img src={image.dataUrl || image.sourceUrl} alt={image.name} /><span className="image-editor-grid__name" title={image.name}>{image.name}</span><div className="image-editor-grid__actions"><button type="button" className="icon-button icon-button--small" onClick={() => onCrop(image)} title="等比裁切" aria-label={`裁切图片 ${image.name}`}><Crop size={14} /><span className="sr-only">裁切</span></button><button type="button" className="icon-button icon-button--small image-editor-grid__delete" onClick={() => onChange((current) => current.filter((entry) => entry.id !== image.id))} title="删除图片" aria-label={`删除图片 ${image.name}`}><X size={14} /><span className="sr-only">删除</span></button></div></div>)}</div> : null}<div className="paste-zone paste-zone--drop" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={() => input.current?.click()}><ImagePlus size={22} /><span>拖入图片，或点击选择</span></div></section>;
}

async function handlePaste(
  event: ReactClipboardEvent,
  update: (fn: (account: AccountRecord) => AccountRecord) => void,
  setError: (message: string) => void,
) {
  const files = [...event.clipboardData.files].filter(isImageFile);
  if (!files.length) return;
  event.preventDefault();
  setError("");
  try {
    const images = await Promise.all(files.map(async (file) => ({ id: createId("image"), name: file.name || "粘贴图片", dataUrl: await readFileAsDataUrl(file) })));
    update((account) => ({
      ...account,
      images: [...account.images, ...images],
      visibleModules: account.visibleModules.includes("images")
        ? account.visibleModules
        : ALL_ACCOUNT_MODULES.filter((module) => module === "images" || account.visibleModules.includes(module)),
    }));
  } catch (reason) {
    setError(`图片粘贴失败：${String(reason)}`);
  }
}

function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return <Modal title={title} onClose={onCancel} width="small"><div className="modal-body confirm-dialog"><p>{message}</p></div><footer className="modal-footer"><button className="button button--quiet" onClick={onCancel}>取消</button><button className="button button--danger" onClick={onConfirm}><Trash2 size={15} /> 确认删除</button></footer></Modal>;
}
