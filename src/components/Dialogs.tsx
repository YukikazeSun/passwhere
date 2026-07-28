import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type ReactNode } from "react";
import {
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FileCheck2,
  FolderOpen,
  HardDrive,
  ImagePlus,
  Images,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Layers3,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Tags,
  Trash2,
  Upload,
  WandSparkles,
  WifiOff,
  Users,
  X,
} from "lucide-react";
import type {
  AccountRecord,
  AppSettings,
  AuditEvent,
  Category,
  CustomField,
  Id,
  ImportCounts,
  PreparedImport,
  SecurityQuestion,
  ServiceRecord,
  StorageStats,
  StoredImage,
  Tag,
} from "../types";
import { createId, formatByteSize, getCategoryPath, nowIso } from "../lib/utils";
import { fetchRemoteImage, isImageFile, readFileAsDataUrl } from "../lib/storage";
import { useUnsavedChanges } from "../lib/useUnsavedChanges";
import { validateTags } from "../lib/tagRules";
import {
  applyPasswordTemplate,
  inspectPasswordTemplate,
  validatePasswordTemplate,
  WEBSITE_NAME_PLACEHOLDER,
} from "../lib/passwordTemplate";
import { IconAvatar } from "./IconAvatar";

export function Modal({ title, subtitle, onClose, children, width = "medium" }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: "small" | "medium" | "large" | "wide" }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal--${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function UnsavedChangesDialog({ canSave, onSave, onDiscard, onContinue }: {
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal title="有未保存的修改" subtitle="关闭前请选择如何处理当前内容" onClose={onContinue} width="small">
      <div className="modal-body confirm-dialog"><p>当前编辑内容尚未保存。直接放弃后无法恢复。</p></div>
      <footer className="modal-footer modal-footer--three-actions">
        <button className="button button--quiet" onClick={onContinue}>继续编辑</button>
        <button className="button button--danger" onClick={onDiscard}>放弃修改</button>
        <button className="button button--primary" disabled={!canSave} onClick={onSave}><Check size={15} /> 保存修改</button>
      </footer>
    </Modal>
  );
}

export function ServiceEditor({
  service,
  categories,
  tags,
  onClose,
  onSave,
  onDelete,
}: {
  service: ServiceRecord | null;
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  onSave: (service: ServiceRecord) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(service?.name || "");
  const [url, setUrl] = useState(service?.url || "");
  const [categoryId, setCategoryId] = useState<Id | null>(service?.categoryId || null);
  const [tagIds, setTagIds] = useState<Id[]>(service?.tagIds || []);
  const [icon, setIcon] = useState<StoredImage | null>(service?.icon || null);
  const iconInput = useRef<HTMLInputElement>(null);
  const originalTagIds = service?.tagIds || [];
  const isDirty = name !== (service?.name || "")
    || url !== (service?.url || "")
    || categoryId !== (service?.categoryId || null)
    || tagIds.length !== originalTagIds.length
    || tagIds.some((id, index) => id !== originalTagIds[index])
    || icon !== (service?.icon || null);
  const unsaved = useUnsavedChanges(isDirty, onClose);

  const saveDraft = () => {
    if (!name.trim()) return;
    const timestamp = nowIso();
    onSave({
      id: service?.id || createId("service"),
      name: name.trim(),
      url: url.trim(),
      categoryId,
      tagIds,
      icon,
      createdAt: service?.createdAt || timestamp,
      updatedAt: timestamp,
      revision: service?.revision ?? 0,
      modifiedByDeviceId: service?.modifiedByDeviceId || "",
      sortOrder: service?.sortOrder ?? 0,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };

  const onIconFile = async (file?: File) => {
    if (!file || !isImageFile(file)) return;
    setIcon({ id: service?.icon?.id || createId("icon"), name: file.name, dataUrl: await readFileAsDataUrl(file) });
  };

  return (<>
    <Modal title={service ? "编辑软件分区" : "新建软件分区"} subtitle="一个分区可包含多个相互独立的账号" onClose={unsaved.requestClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <div className="icon-picker-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void onIconFile(event.dataTransfer.files[0]); }}>
            <IconAvatar name={name || "新"} image={icon} size="large" />
            <div><strong>分区图标</strong><span>点击或拖入图片，支持 .ico</span></div>
            <input ref={iconInput} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.ico" hidden onChange={(event) => onIconFile(event.target.files?.[0])} />
            <button type="button" className="button button--secondary" onClick={() => iconInput.current?.click()}><ImagePlus size={15} /> 选择图片</button>
          </div>
          <label className="form-field"><span>名称 *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 Steam" /></label>
          <label className="form-field"><span>登录网址</span><div className="input-with-icon"><Link2 size={16} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></div></label>
          <label className="form-field"><span>分类</span><select value={categoryId || ""} onChange={(event) => setCategoryId(event.target.value || null)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{getCategoryPath(category.id, categories)}</option>)}</select></label>
          <fieldset className="form-field"><legend>标签（可多选）</legend><div className="tag-choice-grid">{tags.map((tag) => <label key={tag.id} className="tag-choice"><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} /><span style={{ backgroundColor: tag.color }} />{tag.name}</label>)}</div></fieldset>
        </div>
        <footer className="modal-footer">{service && onDelete ? <button type="button" className="button button--danger" onClick={onDelete}><Trash2 size={15} /> 删除分区</button> : <span />}<div><button type="button" className="button button--quiet" onClick={unsaved.requestClose}>取消</button><button className="button button--primary" disabled={!name.trim()}><Check size={16} /> 保存</button></div></footer>
      </form>
    </Modal>
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={Boolean(name.trim())} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}

export function AccountEditor({
  account,
  serviceId,
  onClose,
  onSave,
}: {
  account: AccountRecord | null;
  serviceId: Id;
  onClose: () => void;
  onSave: (account: AccountRecord) => void;
}) {
  const [label, setLabel] = useState(account?.label || "");
  const [username, setUsername] = useState(account?.username || "");
  const [password, setPassword] = useState(account?.password || "");
  const [identityCode, setIdentityCode] = useState(account?.identityCode || "");
  const [notes, setNotes] = useState(account?.notes[0]?.content || "");
  const [questions, setQuestions] = useState<SecurityQuestion[]>(account?.securityQuestions || []);
  const [fields, setFields] = useState<CustomField[]>(account?.customFields || []);
  const [images, setImages] = useState<StoredImage[]>(account?.images || []);
  const [imageUrl, setImageUrl] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    const timestamp = nowIso();
    onSave({
      id: account?.id || createId("account"),
      serviceId,
      label: label.trim(),
      username,
      password,
      identityCode,
      notes: notes ? [{ id: account?.notes[0]?.id || createId("note"), title: account?.notes[0]?.title || "账号备注", content: notes }] : [],
      visibleModules: account?.visibleModules || ["username", "password", "identity", "security", "custom", "notes", "images"],
      sortOrder: account?.sortOrder ?? 0,
      securityQuestions: questions.filter((item) => item.question || item.answer),
      customFields: fields.filter((item) => item.label || item.value),
      images,
      passwordHistory: account?.passwordHistory || [],
      createdAt: account?.createdAt || timestamp,
      updatedAt: timestamp,
      revision: account?.revision ?? 0,
      modifiedByDeviceId: account?.modifiedByDeviceId || "",
    });
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const imageFiles = [...fileList].filter(isImageFile);
    const additions = await Promise.all(imageFiles.map(async (file) => ({ id: createId("image"), name: file.name, dataUrl: await readFileAsDataUrl(file) })));
    setImages((current) => [...current, ...additions]);
  };

  const addRemoteImage = async () => {
    const url = imageUrl.trim();
    if (!/^https?:\/\//.test(url)) return;
    setLoadingImage(true);
    try {
      const dataUrl = await fetchRemoteImage(url);
      const filename = new URL(url).pathname.split("/").pop() || "网络图片";
      setImages((current) => [...current, { id: createId("image"), name: filename, dataUrl, sourceUrl: url }]);
      setImageUrl("");
    } finally {
      setLoadingImage(false);
    }
  };

  const onPaste = (event: ReactClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some(isImageFile)) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <Modal title={account ? `编辑 ${account.label}` : "新增账号"} subtitle="账号之间相互独立；修改密码会在保存后单独确认" onClose={onClose} width="large">
      <form onSubmit={submit}>
        <div className="modal-body account-editor" onPaste={onPaste}>
          <section className="editor-section"><h3>基本信息</h3><div className="form-grid"><label className="form-field"><span>账号标记 *</span><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如 主账号" /></label><label className="form-field"><span>登录账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="form-field"><span>当前密码</span><input value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="form-field"><span>身份识别码</span><textarea rows={2} value={identityCode} onChange={(event) => setIdentityCode(event.target.value)} /></label></div></section>

          <section className="editor-section"><div className="editor-section__heading"><h3>密保问题</h3><button type="button" className="button button--quiet" onClick={() => setQuestions((current) => [...current, { id: createId("question"), question: "", answer: "" }])}><Plus size={14} /> 添加</button></div>{questions.length === 0 ? <p className="editor-empty">没有密保问题</p> : <div className="repeater-list">{questions.map((item, index) => <div key={item.id} className="repeater-row"><input aria-label={`密保问题 ${index + 1}`} value={item.question} placeholder="问题" onChange={(event) => setQuestions((current) => current.map((entry) => entry.id === item.id ? { ...entry, question: event.target.value } : entry))} /><input aria-label={`密保回答 ${index + 1}`} value={item.answer} placeholder="回答" onChange={(event) => setQuestions((current) => current.map((entry) => entry.id === item.id ? { ...entry, answer: event.target.value } : entry))} /><button type="button" className="icon-button icon-button--small" onClick={() => setQuestions((current) => current.filter((entry) => entry.id !== item.id))} title="删除"><Trash2 size={15} /></button></div>)}</div>}</section>

          <section className="editor-section"><div className="editor-section__heading"><h3>自定义字段</h3><button type="button" className="button button--quiet" onClick={() => setFields((current) => [...current, { id: createId("field"), label: "", value: "", multiline: false, copyable: true }])}><Plus size={14} /> 添加</button></div>{fields.length === 0 ? <p className="editor-empty">可记录恢复码、许可证、服务器地址等信息</p> : <div className="repeater-list">{fields.map((field, index) => <div key={field.id} className="custom-editor-row"><input aria-label={`字段名称 ${index + 1}`} value={field.label} placeholder="字段名称" onChange={(event) => setFields((current) => current.map((entry) => entry.id === field.id ? { ...entry, label: event.target.value } : entry))} />{field.multiline ? <textarea aria-label={`字段内容 ${index + 1}`} rows={2} value={field.value} placeholder="字段内容" onChange={(event) => setFields((current) => current.map((entry) => entry.id === field.id ? { ...entry, value: event.target.value } : entry))} /> : <input aria-label={`字段内容 ${index + 1}`} value={field.value} placeholder="字段内容" onChange={(event) => setFields((current) => current.map((entry) => entry.id === field.id ? { ...entry, value: event.target.value } : entry))} />}<label className="compact-check"><input type="checkbox" checked={field.multiline} onChange={() => setFields((current) => current.map((entry) => entry.id === field.id ? { ...entry, multiline: !entry.multiline } : entry))} />多行</label><label className="compact-check"><input type="checkbox" checked={field.copyable} onChange={() => setFields((current) => current.map((entry) => entry.id === field.id ? { ...entry, copyable: !entry.copyable } : entry))} /><Copy size={13} /></label><button type="button" className="icon-button icon-button--small" onClick={() => setFields((current) => current.filter((entry) => entry.id !== field.id))} title="删除"><Trash2 size={15} /></button></div>)}</div>}</section>

          <section className="editor-section"><h3>备注</h3><label className="form-field"><span>可直接填写网址，详情页会显示为可点击链接</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></section>

          <section className="editor-section"><div className="editor-section__heading"><div><h3>图片</h3><p>支持选择文件、直接粘贴截图或添加图片网址</p></div><input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.ico" multiple hidden onChange={(event) => event.target.files && void addFiles(event.target.files)} /><button type="button" className="button button--secondary" onClick={() => fileInput.current?.click()}><Upload size={14} /> 选择图片</button></div><div className="image-url-row"><div className="input-with-icon"><Link2 size={15} /><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="粘贴图片网址" /></div><button type="button" className="button button--quiet" onClick={() => void addRemoteImage()} disabled={loadingImage || !imageUrl.trim()}>{loadingImage ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} 添加</button></div>{images.length > 0 ? <div className="image-editor-grid">{images.map((image) => <div key={image.id}><img src={image.dataUrl || image.sourceUrl} alt={image.name} /><span title={image.name}>{image.name}</span><button type="button" className="icon-button icon-button--small" onClick={() => setImages((current) => current.filter((entry) => entry.id !== image.id))} title="删除图片"><X size={14} /></button></div>)}</div> : <div className="paste-zone"><ImagePlus size={22} /><span>在此窗口按 Ctrl+V 粘贴截图</span></div>}</section>
        </div>
        <footer className="modal-footer"><span /><div><button type="button" className="button button--quiet" onClick={onClose}>取消</button><button className="button button--primary" disabled={!label.trim()}><Check size={16} /> 保存账号</button></div></footer>
      </form>
    </Modal>
  );
}

export function PasswordDecision({ accountLabel, oldPassword, newPassword, onCancel, onConfirm }: { accountLabel: string; oldPassword: string; newPassword: string; onCancel: () => void; onConfirm: (keepOld: boolean) => void }) {
  return (
    <Modal title="确认密码更新" subtitle={`${accountLabel} 的密码与已保存内容不同`} onClose={onCancel} width="small">
      <div className="modal-body password-decision"><div><span>原密码</span><code>{oldPassword || "（空）"}</code></div><div><span>新密码</span><code>{newPassword || "（空）"}</code></div><p>请确认这是一次正式更新，还是误输入。</p></div>
      <footer className="modal-footer modal-footer--stack"><button className="button button--quiet" onClick={onCancel}><RotateCcw size={15} /> 返回检查</button><button className="button button--secondary" onClick={() => onConfirm(false)}>更新，不保留旧密码</button><button className="button button--primary" onClick={() => onConfirm(true)}>更新并保留旧密码</button></footer>
    </Modal>
  );
}

export function CategoryEditor({ category, parentName, parentId, onClose, onSave }: {
  category: Category | null;
  parentName?: string;
  parentId: Id | null;
  onClose: () => void;
  onSave: (category: Category) => void;
}) {
  const [name, setName] = useState(category?.name || "");
  const [color, setColor] = useState(category?.color || "#3f6f8f");
  const isDirty = name !== (category?.name || "") || color !== (category?.color || "#3f6f8f");
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const saveDraft = () => {
    if (!name.trim()) return;
    const timestamp = nowIso();
    onSave({
      id: category?.id || createId("category"),
      name: name.trim(),
      color,
      parentId: category?.parentId ?? parentId,
      sortOrder: category?.sortOrder ?? 0,
      revision: category?.revision ?? 0,
      updatedAt: category?.updatedAt || timestamp,
      modifiedByDeviceId: category?.modifiedByDeviceId || "",
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };
  return (<>
    <Modal title={category ? "编辑分类" : parentId ? "新建子分类" : "新建分类"} subtitle={parentName ? `上级分类：${parentName}` : "顶级分类"} onClose={unsaved.requestClose} width="small">
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="form-field"><span>名称 *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>识别颜色</span><div className="color-field"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span style={{ backgroundColor: color }} /> <code>{color}</code></div></label>
        </div>
        <footer className="modal-footer"><span /><div><button type="button" className="button button--quiet" onClick={unsaved.requestClose}>取消</button><button className="button button--primary" disabled={!name.trim()}><Check size={16} /> 保存</button></div></footer>
      </form>
    </Modal>
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={Boolean(name.trim())} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}

export function TagManager({ initialTags, usageCounts, onClose, onSave }: { initialTags: Tag[]; usageCounts: Record<Id, number>; onClose: () => void; onSave: (tags: Tag[]) => void }) {
  const [tags, setTags] = useState(initialTags);
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);
  const isDirty = tags.length !== initialTags.length
    || tags.some((tag, index) => tag.id !== initialTags[index]?.id || tag.name !== initialTags[index]?.name || tag.color !== initialTags[index]?.color);
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const validation = validateTags(tags);
  const saveDraft = () => { if (validation.valid) onSave(validation.normalized); };
  const removeTag = (tag: Tag) => {
    if (usageCounts[tag.id]) {
      setPendingDelete(tag);
      return;
    }
    setTags((current) => current.filter((item) => item.id !== tag.id));
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    setTags((current) => current.filter((item) => item.id !== pendingDelete.id));
    setPendingDelete(null);
  };
  return (<>
    <Modal title="管理标签" subtitle="标签用于组合筛选，可自定义名称和颜色" onClose={unsaved.requestClose} width="medium">
      <div className="modal-body">
        <div className="editor-section__heading"><h3>标签清单</h3><button className="button button--quiet" onClick={() => setTags((current) => [...current, { id: createId("tag"), name: "", color: "#a64b45", revision: 0, updatedAt: nowIso(), modifiedByDeviceId: "" }])}><Plus size={14} /> 添加标签</button></div>
        <div className="taxonomy-list tag-manager-list">{tags.map((tag, index) => <div key={tag.id}>
          <input type="color" aria-label={`标签颜色 ${index + 1}`} value={tag.color} onChange={(event) => setTags((current) => current.map((item) => item.id === tag.id ? { ...item, color: event.target.value } : item))} />
          <label className="tag-manager-name"><input autoFocus={index === tags.length - 1 && !tag.name} aria-label={`标签名称 ${index + 1}`} aria-invalid={Boolean(validation.errors[tag.id])} value={tag.name} placeholder="标签名称" onChange={(event) => setTags((current) => current.map((item) => item.id === tag.id ? { ...item, name: event.target.value } : item))} />{validation.errors[tag.id] ? <small>{validation.errors[tag.id]}</small> : null}</label>
          <span className="tag-manager-usage">{usageCounts[tag.id] || 0} 个分区</span>
          <button className="icon-button icon-button--small" onClick={() => removeTag(tag)} title={`删除标签${usageCounts[tag.id] ? `（${usageCounts[tag.id]} 个引用）` : ""}`}><Trash2 size={15} /></button>
        </div>)}</div>
        {tags.length === 0 ? <div className="editor-empty">还没有标签</div> : null}
      </div>
      <footer className="modal-footer"><span>{validation.valid ? `${tags.length} 个标签` : "请修正标签名称"}</span><div><button className="button button--quiet" onClick={unsaved.requestClose}>取消</button><button className="button button--primary" onClick={saveDraft} disabled={!validation.valid}><Check size={16} /> 保存</button></div></footer>
    </Modal>
    {pendingDelete ? <Modal title="删除标签" subtitle="删除后将同步解除分区引用" onClose={() => setPendingDelete(null)} width="small"><div className="modal-body confirm-dialog"><p>“{pendingDelete.name}”正在被 {usageCounts[pendingDelete.id]} 个分区引用。确定删除此标签并解除全部引用吗？</p></div><footer className="modal-footer"><span /><div><button className="button button--quiet" onClick={() => setPendingDelete(null)}>取消</button><button className="button button--danger" onClick={confirmDelete}><Trash2 size={15} /> 确认删除</button></div></footer></Modal> : null}
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={validation.valid} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}

export function LockScreen({ busy, error, onUnlock }: { busy: boolean; error: string; onUnlock: (credential: string) => void }) {
  const [credential, setCredential] = useState("");
  return (
    <main className="lock-screen">
      <form className="unlock-panel" onSubmit={(event) => { event.preventDefault(); if (credential) onUnlock(credential); }}>
        <div className="unlock-mark"><LockKeyhole size={26} /></div>
        <div><h1>我密码呢已锁定</h1><p>输入启动密码或 16 位恢复码</p></div>
        <label className="form-field"><span>密码或恢复码</span><input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="current-password" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--full" disabled={!credential || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} 解锁</button>
      </form>
    </main>
  );
}

export function BackupCredentialDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (credential: string) => Promise<void> }) {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="解锁备份" subtitle="输入创建备份时使用的启动密码或恢复码" onClose={onClose} width="small">
      <form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void onSubmit(credential).catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }}>
        <div className="modal-body form-stack"><label className="form-field"><span>密码或恢复码</span><input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} /></label>{error ? <p className="form-error">{error}</p> : null}</div>
        <footer className="modal-footer"><span /><div><button type="button" className="button button--quiet" onClick={onClose}>取消</button><button className="button button--primary" disabled={!credential || busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />} 解锁并导入</button></div></footer>
      </form>
    </Modal>
  );
}

export function ImportPreviewDialog({ preview, busy, error, onClose, onConfirm }: {
  preview: PreparedImport;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const createdAt = new Date(preview.createdAt);
  const createdLabel = Number.isNaN(createdAt.getTime()) ? preview.createdAt : createdAt.toLocaleString("zh-CN", { hour12: false });
  const metrics = [
    { label: "分区", value: preview.counts.services, icon: Layers3 },
    { label: "账号", value: preview.counts.accounts, icon: Users },
    { label: "图片", value: preview.counts.images, icon: Images },
    { label: "分类 / 标签", value: `${preview.counts.categories} / ${preview.counts.tags}`, icon: Tags },
  ];
  const sourceLabel = preview.sourceType === "encrypted"
    ? "加密完整备份"
    : preview.sourceType === "excel"
      ? "标准 Excel 模板"
      : "JSON 完整备份";
  return (
    <Modal title="确认导入备份" subtitle="核对内容后再替换当前数据" onClose={onClose} width="medium">
      <div className="modal-body import-preview">
        <div className="import-preview__source"><FileCheck2 size={22} /><div><strong>{preview.fileName}</strong><span>{sourceLabel}</span></div></div>
        <dl className="import-preview__metadata"><div><dt>数据版本</dt><dd>v{preview.sourceVersion}</dd></div><div><dt>{preview.sourceType === "encrypted" ? "备份时间" : preview.sourceType === "excel" ? "导出时间" : "文件时间"}</dt><dd>{createdLabel}</dd></div></dl>
        <div className="import-preview__metrics">{metrics.map(({ label, value, icon: Icon }) => <div key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="import-preview__warning"><HardDrive size={18} /><div><strong>将替换当前全部数据</strong><span>程序会先创建加密回滚备份；备份失败时不会开始导入。</span></div></div>
        {error ? <p className="form-error import-preview__error" role="alert">{error}</p> : null}
      </div>
      <footer className="modal-footer"><span>当前数据不会与备份合并</span><div><button className="button button--quiet" onClick={onClose} disabled={busy}>取消</button><button className="button button--primary" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} 创建回滚备份并导入</button></div></footer>
    </Modal>
  );
}

export function ImportResultDialog({ rollbackPath, counts, onClose, onOpenDirectory }: {
  rollbackPath: string;
  counts: ImportCounts;
  onClose: () => void;
  onOpenDirectory: () => void;
}) {
  return (
    <Modal title="导入完成" subtitle={`${counts.services} 个分区、${counts.accounts} 个账号已恢复`} onClose={onClose} width="medium">
      <div className="modal-body import-result"><div className="import-result__status"><ShieldCheck size={23} /><div><strong>数据已完成替换</strong><span>导入前的数据已保留为独立加密备份。</span></div></div><label><span>回滚备份路径</span><code>{rollbackPath}</code></label><p>需要撤销本次导入时，重新导入此文件即可。</p></div>
      <footer className="modal-footer"><button className="button button--secondary" onClick={onOpenDirectory}><FolderOpen size={15} /> 打开数据目录</button><button className="button button--primary" onClick={onClose}>完成</button></footer>
    </Modal>
  );
}

export function DataExchangeDialog({ busyAction, result, error, onClose, onBackup, onImport, onExportExcel, onExportWord }: {
  busyAction: "backup" | "import" | "excel" | "word" | null;
  result: string;
  error: string;
  onClose: () => void;
  onBackup: () => void;
  onImport: (file: File) => void;
  onExportExcel: () => void;
  onExportWord: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = busyAction !== null;
  const ActionIcon = ({ action, children }: { action: typeof busyAction; children: ReactNode }) => busyAction === action
    ? <LoaderCircle className="spin" size={17} />
    : children;
  return (
    <Modal title="数据交换" subtitle="备份、Office 导入与导出集中在这里" onClose={onClose} width="large">
      <div className="modal-body exchange-dialog">
        <div className="exchange-warning"><ShieldAlert size={19} /><div><strong>Office 文件包含明文敏感信息</strong><span>Excel 和 Word 会写入明文账号、密码、密保答案及历史密码。仅在需要查看、打印或编辑时导出，并妥善保管文件。</span></div></div>
        <section className="exchange-section">
          <div className="exchange-section__title"><strong>完整备份与恢复</strong><span>加密备份用于迁移和回滚，优先于 Office 文件。</span></div>
          <div className="exchange-actions">
            <button className="exchange-action" disabled={busy} onClick={onBackup}><ActionIcon action="backup"><Download size={18} /></ActionIcon><div><strong>创建加密备份</strong><span>保存全部数据和图片，可用于完整恢复</span></div></button>
            <button className="exchange-action" disabled={busy} onClick={() => input.current?.click()}><ActionIcon action="import"><Upload size={18} /></ActionIcon><div><strong>导入数据</strong><span>支持 .anb、.json 和本程序标准 .xlsx</span></div></button>
            <input ref={input} type="file" hidden accept=".anb,.json,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} />
          </div>
        </section>
        <section className="exchange-section">
          <div className="exchange-section__title"><strong>Office 文件</strong><span>Excel 可重新导入；Word 仅用于查看和打印。</span></div>
          <div className="exchange-actions">
            <button className="exchange-action" disabled={busy} onClick={onExportExcel}><ActionIcon action="excel"><FileSpreadsheet size={18} /></ActionIcon><div><strong>导出标准 Excel</strong><span>完整结构化字段、图片预览和无损图片数据</span></div></button>
            <button className="exchange-action" disabled={busy} onClick={onExportWord}><ActionIcon action="word"><FileText size={18} /></ActionIcon><div><strong>导出只读 Word</strong><span>按分区和账号排版，适合查看与打印</span></div></button>
          </div>
        </section>
        {error ? <p className="form-error exchange-message" role="alert">{error}</p> : null}
        {result ? <div className="exchange-result"><FileCheck2 size={17} /><span>{result}</span></div> : null}
      </div>
      <footer className="modal-footer"><span>桌面版文件保存到 data/exports 或 data/backups</span><button className="button button--secondary" disabled={busy} onClick={onClose}>关闭</button></footer>
    </Modal>
  );
}

export function SettingsDialog({ status, passwordTemplate, encryptImages, onClose, onEnable, onChange, onRegenerate, onDisable, onLock, onLoadStats, onSaveSettings }: {
  status: { startupLockEnabled: boolean; requiresPasswordChange: boolean };
  passwordTemplate: string;
  encryptImages: boolean;
  onClose: () => void;
  onEnable: (password: string) => Promise<string>;
  onChange: (password: string) => Promise<void>;
  onRegenerate: () => Promise<string>;
  onDisable: () => Promise<void>;
  onLock: () => Promise<void>;
  onLoadStats: () => Promise<StorageStats>;
  onSaveSettings: (settings: AppSettings) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"security" | "password" | "data">("security");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRecoveryRotation, setConfirmRecoveryRotation] = useState(false);
  const [rotationError, setRotationError] = useState("");
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [savedTemplate, setSavedTemplate] = useState(passwordTemplate);
  const [templateDraft, setTemplateDraft] = useState(passwordTemplate);
  const [savedImageEncryption, setSavedImageEncryption] = useState(encryptImages);
  const [imageEncryptionDraft, setImageEncryptionDraft] = useState(encryptImages);
  const [exampleName, setExampleName] = useState("示例网站");
  const templateInput = useRef<HTMLTextAreaElement>(null);
  const templateError = validatePasswordTemplate(templateDraft);
  const templateStructure = inspectPasswordTemplate(templateDraft);
  const templatePreview = applyPasswordTemplate(templateDraft, exampleName);
  const templateDirty = templateDraft !== savedTemplate;
  const imageEncryptionDirty = imageEncryptionDraft !== savedImageEncryption;
  const settingsDirty = templateDirty || imageEncryptionDirty;
  const unsaved = useUnsavedChanges(settingsDirty, onClose);

  const refreshStats = async () => {
    setStatsLoading(true);
    setStatsError("");
    try {
      setStats(await onLoadStats());
    } catch (reason) {
      setStatsError(String(reason));
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const submitPassword = async () => {
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (status.startupLockEnabled) {
        await onChange(password);
        setPassword("");
        setConfirmation("");
      } else {
        setRecoveryCode(await onEnable(password));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setRotationError("");
    try {
      const code = await onRegenerate();
      setRecoveryCode(code);
      setRecoverySaved(false);
      setConfirmRecoveryRotation(false);
    } catch (reason) {
      setRotationError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const insertWebsitePlaceholder = () => {
    const input = templateInput.current;
    const start = input?.selectionStart ?? templateDraft.length;
    const end = input?.selectionEnd ?? start;
    setTemplateDraft(`${templateDraft.slice(0, start)}${WEBSITE_NAME_PLACEHOLDER}${templateDraft.slice(end)}`);
    window.requestAnimationFrame(() => {
      input?.focus();
      const cursor = start + WEBSITE_NAME_PLACEHOLDER.length;
      input?.setSelectionRange(cursor, cursor);
    });
  };

  const savePasswordTemplate = async (closeAfterSave = false) => {
    if (templateError) return;
    setBusy(true);
    try {
      const saved = await onSaveSettings({ passwordTemplate: templateDraft, encryptImages: savedImageEncryption });
      if (!saved) return;
      setSavedTemplate(templateDraft);
      if (closeAfterSave) onClose();
    } finally {
      setBusy(false);
    }
  };

  const saveImageEncryption = async () => {
    setBusy(true);
    try {
      const saved = await onSaveSettings({ passwordTemplate: savedTemplate, encryptImages: imageEncryptionDraft });
      if (saved) setSavedImageEncryption(imageEncryptionDraft);
    } finally {
      setBusy(false);
    }
  };

  const saveAllAndClose = async () => {
    if (templateError) return;
    setBusy(true);
    try {
      const saved = await onSaveSettings({ passwordTemplate: templateDraft, encryptImages: imageEncryptionDraft });
      if (!saved) return;
      setSavedTemplate(templateDraft);
      setSavedImageEncryption(imageEncryptionDraft);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (recoveryCode && !recoverySaved) return;
    unsaved.requestClose();
  };

  const backupTime = stats?.lastBackupAt
    ? new Date(stats.lastBackupAt).toLocaleString("zh-CN", { hour12: false })
    : "尚未创建备份";

  return (
    <>
      <Modal title="设置" subtitle="本机偏好与数据保护" onClose={requestClose} width="medium">
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分区">
            <button className={tab === "security" ? "is-active" : ""} onClick={() => setTab("security")}><ShieldCheck size={16} />安全</button>
            <button className={tab === "password" ? "is-active" : ""} onClick={() => setTab("password")}><WandSparkles size={16} />密码模板</button>
            <button className={tab === "data" ? "is-active" : ""} onClick={() => setTab("data")}><HardDrive size={16} />数据</button>
          </nav>
          <div className="modal-body settings-content">
            {tab === "security" ? <>
              {status.requiresPasswordChange ? <div className="security-alert"><ShieldCheck size={17} /><div><strong>已使用恢复码进入</strong><span>请立即设置新的启动密码。</span></div></div> : null}
              <div className="setting-row"><div><strong>启动密码</strong><span>{status.startupLockEnabled ? "已启用，重新打开软件时需要解锁" : "未启用，软件打开后直接进入"}</span></div><span className={`status-pill ${status.startupLockEnabled ? "is-on" : ""}`}>{status.startupLockEnabled ? "已开启" : "已关闭"}</span></div>
              {recoveryCode ? <div className="recovery-panel"><span>新恢复码仅显示这一次</span><code>{recoveryCode}</code><button className="button button--secondary" onClick={() => void navigator.clipboard.writeText(recoveryCode)}><Copy size={15} />复制恢复码</button><label className="compact-check"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />我已将恢复码保存在其他位置</label></div> : <>
                <form className="security-form" onSubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
                  <label className="form-field"><span>{status.startupLockEnabled ? "新启动密码" : "设置启动密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 个字符" /></label>
                  <label className="form-field"><span>再次输入</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
                  {error ? <p className="form-error">{error}</p> : null}
                  <div className="security-actions"><button className="button button--primary" disabled={busy || password.length < 8 || !confirmation}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}{status.startupLockEnabled ? "更新密码" : "启用并生成恢复码"}</button>{status.startupLockEnabled ? <button type="button" className="button button--secondary" onClick={() => void onLock()}><LockKeyhole size={15} />立即锁定</button> : null}</div>
                  {status.startupLockEnabled ? <button type="button" className="text-danger-button" onClick={() => { if (window.confirm("关闭启动密码后，软件将恢复为打开即用。继续吗？")) void onDisable(); }}>关闭启动密码</button> : null}
                </form>
                {status.startupLockEnabled ? <div className="recovery-setting"><div><strong>恢复码</strong><span>遗失或泄露时可重新生成，旧码将立即失效。</span></div><button className="button button--secondary" onClick={() => { setRotationError(""); setConfirmRecoveryRotation(true); }}><RotateCcw size={15} />重新生成</button></div> : null}
              </>}
              <div className="image-encryption-setting">
                <div className="image-encryption-heading"><Images size={18} /><div><strong>加密本地图片文件</strong><span>保护 data/images 与 data/icons，避免在资源管理器中直接打开。</span></div></div>
                <div className="image-encryption-control">
                  <label className="toggle-control"><input type="checkbox" checked={imageEncryptionDraft} onChange={(event) => setImageEncryptionDraft(event.target.checked)} disabled={busy} /><span aria-hidden="true" /><b>{imageEncryptionDraft ? "加密" : "普通文件"}</b></label>
                  <span className={`status-pill ${savedImageEncryption && !imageEncryptionDirty ? "is-on" : ""}`}>{imageEncryptionDirty ? "待应用" : savedImageEncryption ? "已加密" : "未加密"}</span>
                  <button type="button" className="button button--primary" onClick={() => void saveImageEncryption()} disabled={busy || !imageEncryptionDirty}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}应用</button>
                </div>
                <p>应用时会迁移现有图片，单张图片会短暂占用约两倍内存。此功能用于阻止直接查看文件；未启用启动密码时，随程序目录保存的自动解锁密钥仍可解密数据。</p>
              </div>
            </> : tab === "password" ? <div className="password-template-settings">
              <div className="setting-row"><div><strong>默认密码模板</strong><span>填入账号草稿前可预览，清空后关闭模板入口</span></div><span className={`status-pill ${templateDraft && !templateError ? "is-on" : ""}`}>{templateError ? "待修正" : templateDraft ? "已配置" : "未配置"}</span></div>
              <label className="form-field"><span>密码结构</span><textarea ref={templateInput} rows={3} maxLength={256} value={templateDraft} onChange={(event) => setTemplateDraft(event.target.value)} placeholder={`例如 Fixed!2026${WEBSITE_NAME_PLACEHOLDER}`} aria-invalid={Boolean(templateError)} /></label>
              <div className="password-template-actions"><button type="button" className="button button--secondary" onClick={insertWebsitePlaceholder}><Plus size={14} />插入 {WEBSITE_NAME_PLACEHOLDER}</button><span>{templateDraft.length} / 256</span></div>
              {templateError ? <p className="form-error" role="alert">{templateError}</p> : null}
              <div className="template-structure" aria-label="模板结构识别">
                {[
                  ["大写英文", templateStructure.uppercase],
                  ["小写英文", templateStructure.lowercase],
                  ["数字", templateStructure.number],
                  ["特殊符号", templateStructure.special],
                  ["网站名称", templateStructure.placeholder],
                ].map(([label, present]) => <span key={String(label)} className={present ? "is-present" : ""}><Check size={12} />{label}</span>)}
              </div>
              <div className="template-preview-block">
                <label className="form-field"><span>预览网站名称</span><input value={exampleName} onChange={(event) => setExampleName(event.target.value)} placeholder="网站或软件名称" /></label>
                <div><span>生成结果 · {templatePreview.length} 字符</span><code>{templatePreview || "未配置模板"}</code></div>
              </div>
              <div className="password-template-save"><button type="button" className="button button--primary" onClick={() => void savePasswordTemplate()} disabled={busy || !templateDirty || Boolean(templateError)}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}保存模板</button></div>
            </div> : <div className="settings-data-panel">
              <div className="settings-data-toolbar"><div><strong>本机存储</strong><span>统计当前数据目录的实际占用</span></div><button className="icon-button icon-button--small" title="刷新存储统计" onClick={() => void refreshStats()} disabled={statsLoading}><RotateCcw className={statsLoading ? "spin" : ""} size={15} /></button></div>
              {statsError ? <p className="form-error">{statsError}</p> : null}
              <div className="settings-data-list">
                <div><FileCheck2 size={18} /><div><strong>最近备份</strong><span>{statsLoading && !stats ? "正在读取…" : `${backupTime}${stats ? ` · ${stats.backupCount} 个备份文件` : ""}`}</span></div></div>
                <div><HardDrive size={18} /><div><strong>本地数据总占用</strong><span>{stats ? formatByteSize(stats.dataSizeBytes) : "--"}，包含数据库、图片、图标、日志和备份</span></div></div>
                <div><Images size={18} /><div><strong>图片占用</strong><span>{stats ? formatByteSize(stats.imageSizeBytes) : "--"}，仅统计已写入本地图片目录的文件</span></div></div>
                <div><WifiOff size={18} /><div><strong>同步</strong><span>已建立记录版本、删除墓碑和本机设备编号；当前不连接网络服务。</span></div></div>
              </div>
            </div>}
          </div>
        </div>
        <footer className="modal-footer"><span>{recoveryCode && !recoverySaved ? "请先确认已另行保存新恢复码" : settingsDirty ? "设置有未保存修改" : ""}</span><button className="button button--primary" disabled={Boolean(recoveryCode) && !recoverySaved} onClick={requestClose}>完成</button></footer>
      </Modal>
      {confirmRecoveryRotation ? <Modal title="重新生成恢复码" subtitle="旧恢复码将立即废止" onClose={() => { if (!busy) setConfirmRecoveryRotation(false); }} width="small">
        <div className="modal-body confirm-dialog"><p>生成新恢复码后，旧码将不能再解锁当前软件。已创建的加密备份仍使用创建时的启动密码或恢复码。</p>{rotationError ? <p className="form-error">{rotationError}</p> : null}</div>
        <footer className="modal-footer"><span /><div><button className="button button--quiet" onClick={() => setConfirmRecoveryRotation(false)} disabled={busy}>取消</button><button className="button button--primary" onClick={() => void regenerate()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}确认并生成新恢复码</button></div></footer>
      </Modal> : null}
      {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={!templateError} onSave={() => void saveAllAndClose()} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
    </>
  );
}

export function LogsDialog({ logs, onClose, onOpenFile }: { logs: AuditEvent[]; onClose: () => void; onOpenFile: () => void }) {
  return (
    <Modal title="修改日志" subtitle="只记录操作与字段名称，不重复写入密码全文" onClose={onClose} width="large">
      <div className="modal-body log-list">{logs.length === 0 ? <div className="editor-empty">还没有修改记录</div> : logs.map((event) => <div key={event.id} className="log-row"><time>{new Date(event.timestamp).toLocaleString("zh-CN", { hour12: false })}</time><strong>{event.action}</strong><span>{event.serviceName}{event.accountLabel ? ` / ${event.accountLabel}` : ""}</span><small>{event.fields.join("、")}</small></div>)}</div>
      <footer className="modal-footer"><button className="button button--secondary" onClick={onOpenFile}><Download size={15} /> 打开日志文件</button><button className="button button--primary" onClick={onClose}>完成</button></footer>
    </Modal>
  );
}

export function ImagePreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return <div className="image-preview" role="dialog" aria-modal="true" aria-label={name} onClick={onClose}><button className="icon-button" onClick={onClose} title="关闭"><X size={20} /></button><img src={url} alt={name} /><span>{name}</span></div>;
}
