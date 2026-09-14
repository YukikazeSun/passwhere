import { useRef, useState, type FormEvent } from "react";
import {
  Check,
  ImagePlus,
  Link2,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Category, Id, ServiceRecord, StoredImage, Tag } from "../types";
import { createId, getCategoryPath, nowIso } from "../lib/utils";
import { isImageFile, readFileAsDataUrl } from "../lib/storage";
import { useUnsavedChanges } from "../lib/useUnsavedChanges";
import { useAsyncEditorSave, type EditorSaveResult } from "../lib/useAsyncEditorSave";
import { validateTags } from "../lib/tagRules";
import { IconAvatar } from "./IconAvatar";
import { Modal, UnsavedChangesDialog } from "./Modal";

export function ServiceEditor({
  service,
  initialCategoryId,
  categories,
  tags,
  onClose,
  onSave,
  onDelete,
}: {
  service: ServiceRecord | null;
  initialCategoryId?: Id | null;
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  onSave: (service: ServiceRecord) => Promise<EditorSaveResult>;
  onDelete?: () => Promise<EditorSaveResult>;
}) {
  const initialServiceCategoryId = service?.categoryId ?? initialCategoryId ?? null;
  const [name, setName] = useState(service?.name || "");
  const [url, setUrl] = useState(service?.url || "");
  const [categoryId, setCategoryId] = useState<Id | null>(initialServiceCategoryId);
  const [tagIds, setTagIds] = useState<Id[]>(service?.tagIds || []);
  const [icon, setIcon] = useState<StoredImage | null>(service?.icon || null);
  const [iconError, setIconError] = useState("");
  const iconInput = useRef<HTMLInputElement>(null);
  const iconRequest = useRef(0);
  const originalTagIds = service?.tagIds || [];
  const isDirty = name !== (service?.name || "")
    || url !== (service?.url || "")
    || categoryId !== initialServiceCategoryId
    || tagIds.length !== originalTagIds.length
    || tagIds.some((id, index) => id !== originalTagIds[index])
    || icon !== (service?.icon || null);
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const { saving, saveError, runSave } = useAsyncEditorSave(onClose);

  const saveDraft = () => {
    if (!name.trim()) return;
    const timestamp = nowIso();
    void runSave(() => onSave({
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
    }));
  };

  const deleteService = () => {
    if (onDelete) void runSave(onDelete);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };

  const onIconFile = async (file?: File) => {
    if (!file) return;
    const requestId = ++iconRequest.current;
    if (!isImageFile(file)) {
      setIconError("请选择 PNG、JPEG、WebP、GIF、BMP 或 ICO 图片");
      return;
    }
    setIconError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (requestId !== iconRequest.current) return;
      setIcon({ id: service?.icon?.id || createId("icon"), name: file.name, dataUrl });
    } catch (reason) {
      if (requestId !== iconRequest.current) return;
      setIconError(`图标添加失败：${String(reason)}`);
    }
  };

  return (<>
    <Modal title={service ? "编辑软件分区" : "新建软件分区"} subtitle="一个分区可包含多个相互独立的账号" onClose={unsaved.requestClose} closeDisabled={saving}>
      <form onSubmit={submit} aria-busy={saving}>
        <fieldset className="modal-fields" disabled={saving}>
        <div className="modal-body form-stack">
          <div className="icon-picker-row" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void onIconFile(event.dataTransfer.files[0]); }}>
            <IconAvatar name={name || "新"} image={icon} size="large" />
            <div><strong>分区图标</strong><span>点击或拖入图片，支持 .ico</span></div>
            <input ref={iconInput} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.ico" hidden onChange={(event) => onIconFile(event.target.files?.[0])} />
            <button type="button" className="button button--secondary" onClick={() => iconInput.current?.click()}><ImagePlus size={15} /> 选择图片</button>
          </div>
          {iconError ? <p className="form-error image-url-error" role="alert">{iconError}</p> : null}
          <label className="form-field"><span>名称 *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 Steam" /></label>
          <label className="form-field"><span>登录网址</span><div className="input-with-icon"><Link2 size={16} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></div></label>
          <label className="form-field"><span>分类</span><select value={categoryId || ""} onChange={(event) => setCategoryId(event.target.value || null)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{getCategoryPath(category.id, categories)}</option>)}</select></label>
          <fieldset className="form-field"><legend>标签（可多选）</legend><div className="tag-choice-grid">{tags.map((tag) => <label key={tag.id} className="tag-choice"><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => setTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} /><span className="tag-choice__check" aria-hidden="true">✓</span><span className="tag-dot" style={{ backgroundColor: tag.color }} /><span className="tag-choice__name">{tag.name}</span></label>)}</div></fieldset>
        </div>
        </fieldset>
        {saveError ? <p className="form-error modal-save-error" role="alert">{saveError}</p> : null}
        <footer className="modal-footer">{service && onDelete ? <button type="button" className="button button--danger" onClick={deleteService} disabled={saving}><Trash2 size={15} /> 删除分区</button> : <span />}<div><button type="button" className="button button--quiet" onClick={unsaved.requestClose} disabled={saving}>取消</button><button className="button button--primary" disabled={!name.trim() || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {saving ? "保存中" : "保存"}</button></div></footer>
      </form>
    </Modal>
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={Boolean(name.trim())} saving={saving} saveError={saveError} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}

export function PasswordDecision({ accountLabel, oldPassword, newPassword, busy = false, onCancel, onConfirm }: { accountLabel: string; oldPassword: string; newPassword: string; busy?: boolean; onCancel: () => void; onConfirm: (keepOld: boolean) => void }) {
  return (
    <Modal title="确认密码更新" subtitle={`${accountLabel} 的密码与已保存内容不同`} onClose={onCancel} width="small" closeDisabled={busy}>
      <div className="modal-body password-decision"><div><span>原密码</span><code>{oldPassword || "（空）"}</code></div><div><span>新密码</span><code>{newPassword || "（空）"}</code></div><p>请确认这是一次正式更新，还是误输入。</p></div>
      <footer className="modal-footer modal-footer--stack"><button className="button button--quiet" onClick={onCancel} disabled={busy}><RotateCcw size={15} /> 返回检查</button><button className="button button--secondary" onClick={() => onConfirm(false)} disabled={busy}>更新，不保留旧密码</button><button className="button button--primary" onClick={() => onConfirm(true)} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : null}更新并保留旧密码</button></footer>
    </Modal>
  );
}

export function CategoryEditor({ category, parentName, parentId, onClose, onSave }: {
  category: Category | null;
  parentName?: string;
  parentId: Id | null;
  onClose: () => void;
  onSave: (category: Category) => Promise<EditorSaveResult>;
}) {
  const [name, setName] = useState(category?.name || "");
  const [color, setColor] = useState(category?.color || "#3f6f8f");
  const isDirty = name !== (category?.name || "") || color !== (category?.color || "#3f6f8f");
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const { saving, saveError, runSave } = useAsyncEditorSave(onClose);
  const saveDraft = () => {
    if (!name.trim()) return;
    const timestamp = nowIso();
    void runSave(() => onSave({
      id: category?.id || createId("category"),
      name: name.trim(),
      color,
      parentId: category?.parentId ?? parentId,
      sortOrder: category?.sortOrder ?? 0,
      revision: category?.revision ?? 0,
      updatedAt: category?.updatedAt || timestamp,
      modifiedByDeviceId: category?.modifiedByDeviceId || "",
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };
  return (<>
    <Modal title={category ? "编辑分类" : parentId ? "新建子分类" : "新建分类"} subtitle={parentName ? `上级分类：${parentName}` : "顶级分类"} onClose={unsaved.requestClose} width="small" closeDisabled={saving}>
      <form onSubmit={submit} aria-busy={saving}>
        <fieldset className="modal-fields" disabled={saving}>
        <div className="modal-body form-stack">
          <label className="form-field"><span>名称 *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>识别颜色</span><div className="color-field"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span style={{ backgroundColor: color }} /> <code>{color}</code></div></label>
        </div>
        </fieldset>
        {saveError ? <p className="form-error modal-save-error" role="alert">{saveError}</p> : null}
        <footer className="modal-footer"><span /><div><button type="button" className="button button--quiet" onClick={unsaved.requestClose} disabled={saving}>取消</button><button className="button button--primary" disabled={!name.trim() || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {saving ? "保存中" : "保存"}</button></div></footer>
      </form>
    </Modal>
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={Boolean(name.trim())} saving={saving} saveError={saveError} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}

export function TagManager({ initialTags, usageCounts, onClose, onSave }: { initialTags: Tag[]; usageCounts: Record<Id, number>; onClose: () => void; onSave: (tags: Tag[]) => Promise<EditorSaveResult> }) {
  const [tags, setTags] = useState(initialTags);
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);
  const isDirty = tags.length !== initialTags.length
    || tags.some((tag, index) => tag.id !== initialTags[index]?.id || tag.name !== initialTags[index]?.name || tag.color !== initialTags[index]?.color);
  const unsaved = useUnsavedChanges(isDirty, onClose);
  const { saving, saveError, runSave } = useAsyncEditorSave(onClose);
  const validation = validateTags(tags);
  const saveDraft = () => { if (validation.valid) void runSave(() => onSave(validation.normalized)); };
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
    <Modal title="管理标签" subtitle="标签用于组合筛选，可自定义名称和颜色" onClose={unsaved.requestClose} width="medium" closeDisabled={saving}>
      <fieldset className="modal-fields" disabled={saving}>
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
      </fieldset>
      {saveError ? <p className="form-error modal-save-error" role="alert">{saveError}</p> : null}
      <footer className="modal-footer"><span>{validation.valid ? `${tags.length} 个标签` : "请修正标签名称"}</span><div><button className="button button--quiet" onClick={unsaved.requestClose} disabled={saving}>取消</button><button className="button button--primary" onClick={saveDraft} disabled={!validation.valid || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {saving ? "保存中" : "保存"}</button></div></footer>
    </Modal>
    {pendingDelete ? <Modal title="删除标签" subtitle="删除后将同步解除分区引用" onClose={() => setPendingDelete(null)} width="small"><div className="modal-body confirm-dialog"><p>“{pendingDelete.name}”正在被 {usageCounts[pendingDelete.id]} 个分区引用。确定删除此标签并解除全部引用吗？</p></div><footer className="modal-footer"><span /><div><button className="button button--quiet" onClick={() => setPendingDelete(null)}>取消</button><button className="button button--danger" onClick={confirmDelete}><Trash2 size={15} /> 确认删除</button></div></footer></Modal> : null}
    {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={validation.valid} saving={saving} saveError={saveError} onSave={saveDraft} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
  </>);
}
