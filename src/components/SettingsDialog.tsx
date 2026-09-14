import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileCheck2,
  HardDrive,
  Images,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  WandSparkles,
  WifiOff,
} from "lucide-react";
import type { AppSettings, Id, RecycleBinItem, StorageStats } from "../types";
import { formatByteSize } from "../lib/utils";
import { useUnsavedChanges } from "../lib/useUnsavedChanges";
import { useAsyncAction } from "../lib/useAsyncAction";
import {
  applyPasswordTemplate,
  inspectPasswordTemplate,
  validatePasswordTemplate,
  WEBSITE_NAME_PLACEHOLDER,
} from "../lib/passwordTemplate";
import { Modal, UnsavedChangesDialog } from "./Modal";
import { RecycleBinPanel } from "./RecycleBinPanel";
import { writeClipboardText } from "../lib/clipboard";

export interface SettingsDialogProps {
  status: { startupLockEnabled: boolean; requiresPasswordChange: boolean };
  passwordTemplate: string;
  encryptImages: boolean;
  recycleBin: RecycleBinItem[];
  onClose: () => void;
  onEnable: (password: string) => Promise<string>;
  onChange: (password: string) => Promise<void>;
  onRegenerate: () => Promise<string>;
  onDisable: () => Promise<void>;
  onLock: () => Promise<void>;
  onLoadStats: () => Promise<StorageStats>;
  onSaveSettings: (settings: AppSettings) => Promise<boolean>;
  onRestoreTrash: (itemId: Id) => Promise<boolean>;
  onDeleteTrash: (itemId: Id) => Promise<boolean>;
  onEmptyTrash: () => Promise<boolean>;
}

export default function SettingsDialog({ status, passwordTemplate, encryptImages, recycleBin, onClose, onEnable, onChange, onRegenerate, onDisable, onLock, onLoadStats, onSaveSettings, onRestoreTrash, onDeleteTrash, onEmptyTrash }: SettingsDialogProps) {
  const [tab, setTab] = useState<"security" | "password" | "data" | "recycle">("security");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryCopyState, setRecoveryCopyState] = useState<"idle" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [settingsError, setSettingsError] = useState("");
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
  const [trashBusyId, setTrashBusyId] = useState<Id | "all" | null>(null);
  const [trashError, setTrashError] = useState("");
  const [pendingTrashDelete, setPendingTrashDelete] = useState<RecycleBinItem | "all" | null>(null);
  const templateInput = useRef<HTMLTextAreaElement>(null);
  const { activeAction, busy, runAction } = useAsyncAction<"password" | "recovery" | "disable" | "lock" | "settings">();
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
    setError("");
    try {
      await runAction("password", async () => {
        if (status.startupLockEnabled) {
          await onChange(password);
          setPassword("");
          setConfirmation("");
        } else {
          setRecoveryCode(await onEnable(password));
        }
      });
    } catch (reason) {
      setError(String(reason));
    }
  };

  const regenerate = async () => {
    setRotationError("");
    try {
      await runAction("recovery", async () => {
        const code = await onRegenerate();
        setRecoveryCode(code);
        setRecoverySaved(false);
        setRecoveryCopyState("idle");
        setConfirmRecoveryRotation(false);
      });
    } catch (reason) {
      setRotationError(String(reason));
    }
  };

  const copyRecoveryCode = async () => {
    try {
      await writeClipboardText(recoveryCode);
      setRecoveryCopyState("success");
    } catch {
      setRecoveryCopyState("error");
    }
  };

  const disableLock = async () => {
    if (!window.confirm("关闭启动密码后，软件将恢复为打开即用。继续吗？")) return;
    setError("");
    try {
      await runAction("disable", onDisable);
    } catch (reason) {
      setError(`关闭启动密码失败：${String(reason)}`);
    }
  };

  const lockNow = async () => {
    setError("");
    try {
      await runAction("lock", onLock);
    } catch (reason) {
      setError(`立即锁定失败：${String(reason)}`);
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
    setSettingsError("");
    try {
      await runAction("settings", async () => {
        const saved = await onSaveSettings({ passwordTemplate: templateDraft, encryptImages: savedImageEncryption });
        if (!saved) {
          setSettingsError("设置保存失败，当前修改仍保留，请重试。");
          return;
        }
        setSavedTemplate(templateDraft);
        if (closeAfterSave) onClose();
      });
    } catch (reason) {
      setSettingsError(`设置保存失败：${String(reason)}`);
    }
  };

  const saveImageEncryption = async () => {
    setSettingsError("");
    try {
      await runAction("settings", async () => {
        const saved = await onSaveSettings({ passwordTemplate: savedTemplate, encryptImages: imageEncryptionDraft });
        if (saved) setSavedImageEncryption(imageEncryptionDraft);
        else setSettingsError("图片加密设置保存失败，当前选择仍保留，请重试。");
      });
    } catch (reason) {
      setSettingsError(`图片加密设置保存失败：${String(reason)}`);
    }
  };

  const saveAllAndClose = async () => {
    if (templateError) return;
    setSettingsError("");
    try {
      await runAction("settings", async () => {
        const saved = await onSaveSettings({ passwordTemplate: templateDraft, encryptImages: imageEncryptionDraft });
        if (!saved) {
          setSettingsError("设置保存失败，当前修改仍保留，请重试。");
          return;
        }
        setSavedTemplate(templateDraft);
        setSavedImageEncryption(imageEncryptionDraft);
        onClose();
      });
    } catch (reason) {
      setSettingsError(`设置保存失败：${String(reason)}`);
    }
  };

  const requestClose = () => {
    if (recoveryCode && !recoverySaved) return;
    unsaved.requestClose();
  };

  const restoreTrash = async (item: RecycleBinItem) => {
    setTrashBusyId(item.id);
    setTrashError("");
    try {
      if (!await onRestoreTrash(item.id)) setTrashError(`“${item.label}”恢复失败，请检查提示后重试。`);
    } catch (reason) {
      setTrashError(`恢复失败：${String(reason)}`);
    } finally {
      setTrashBusyId(null);
    }
  };

  const confirmTrashDelete = async () => {
    if (!pendingTrashDelete) return;
    const target = pendingTrashDelete;
    setPendingTrashDelete(null);
    setTrashBusyId(target === "all" ? "all" : target.id);
    setTrashError("");
    try {
      const saved = target === "all" ? await onEmptyTrash() : await onDeleteTrash(target.id);
      if (!saved) setTrashError(target === "all" ? "清空回收站失败，请重试。" : `“${target.label}”永久删除失败，请重试。`);
    } catch (reason) {
      setTrashError(`永久删除失败：${String(reason)}`);
    } finally {
      setTrashBusyId(null);
    }
  };

  const backupTime = stats?.lastBackupAt
    ? new Date(stats.lastBackupAt).toLocaleString("zh-CN", { hour12: false })
    : "尚未创建备份";

  return (
    <>
      <Modal title="设置" subtitle="本机偏好与数据保护" onClose={requestClose} width="medium" closeDisabled={busy}>
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分区">
            <button className={tab === "security" ? "is-active" : ""} onClick={() => setTab("security")} disabled={busy}><ShieldCheck size={16} />安全</button>
            <button className={tab === "password" ? "is-active" : ""} onClick={() => setTab("password")} disabled={busy}><WandSparkles size={16} />密码模板</button>
            <button className={tab === "data" ? "is-active" : ""} onClick={() => setTab("data")} disabled={busy}><HardDrive size={16} />数据</button>
            <button className={tab === "recycle" ? "is-active" : ""} onClick={() => setTab("recycle")} disabled={busy}><Trash2 size={16} />回收站{recycleBin.length ? <b>{recycleBin.length}</b> : null}</button>
          </nav>
          <div className="modal-body settings-content">
            {tab === "security" ? <>
              {status.requiresPasswordChange ? <div className="security-alert"><ShieldCheck size={17} /><div><strong>已使用恢复码进入</strong><span>请立即设置新的启动密码。</span></div></div> : null}
              <div className="setting-row"><div><strong>启动密码</strong><span>{status.startupLockEnabled ? "已启用，重新打开软件时需要解锁" : "未启用，软件打开后直接进入"}</span></div><span className={`status-pill ${status.startupLockEnabled ? "is-on" : ""}`}>{status.startupLockEnabled ? "已开启" : "已关闭"}</span></div>
              {recoveryCode ? <div className="recovery-panel"><span>新恢复码仅显示这一次</span><code>{recoveryCode}</code><button className="button button--secondary" onClick={() => void copyRecoveryCode()}>{recoveryCopyState === "success" ? <Check size={15} /> : <Copy size={15} />}{recoveryCopyState === "success" ? "已复制" : "复制恢复码"}</button>{recoveryCopyState === "error" ? <p className="form-error" role="alert">恢复码复制失败，请手动复制并重试</p> : null}<label className="compact-check"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />我已将恢复码保存在其他位置</label></div> : <>
                <form className="security-form" onSubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
                  <label className="form-field"><span>{status.startupLockEnabled ? "新启动密码" : "设置启动密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 个字符" /></label>
                  <label className="form-field"><span>再次输入</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
                  {error ? <p className="form-error">{error}</p> : null}
                  <div className="security-actions"><button className="button button--primary" disabled={busy || password.length < 8 || !confirmation}>{activeAction === "password" ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}{status.startupLockEnabled ? "更新密码" : "启用并生成恢复码"}</button>{status.startupLockEnabled ? <button type="button" className="button button--secondary" onClick={() => void lockNow()} disabled={busy}>{activeAction === "lock" ? <LoaderCircle className="spin" size={15} /> : <LockKeyhole size={15} />}立即锁定</button> : null}</div>
                  {status.startupLockEnabled ? <button type="button" className="text-danger-button" onClick={() => void disableLock()} disabled={busy}>{activeAction === "disable" ? "正在关闭…" : "关闭启动密码"}</button> : null}
                </form>
                {status.startupLockEnabled ? <div className="recovery-setting"><div><strong>恢复码</strong><span>遗失或泄露时可重新生成，旧码将立即失效。</span></div><button className="button button--secondary" disabled={busy} onClick={() => { setRotationError(""); setConfirmRecoveryRotation(true); }}><RotateCcw size={15} />重新生成</button></div> : null}
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
            </div> : tab === "data" ? <div className="settings-data-panel">
              <div className="settings-data-toolbar"><div><strong>本机存储</strong><span>统计当前数据目录的实际占用</span></div><button className="icon-button icon-button--small" title="刷新存储统计" onClick={() => void refreshStats()} disabled={statsLoading}><RotateCcw className={statsLoading ? "spin" : ""} size={15} /></button></div>
              {statsError ? <p className="form-error">{statsError}</p> : null}
              <div className="settings-data-list">
                <div><FileCheck2 size={18} /><div><strong>最近备份</strong><span>{statsLoading && !stats ? "正在读取…" : `${backupTime}${stats ? ` · ${stats.backupCount} 个备份文件` : ""}`}</span></div></div>
                <div><HardDrive size={18} /><div><strong>本地数据总占用</strong><span>{stats ? formatByteSize(stats.dataSizeBytes) : "--"}，包含数据库、图片、图标、日志和备份</span></div></div>
                <div><Images size={18} /><div><strong>图片占用</strong><span>{stats ? formatByteSize(stats.imageSizeBytes) : "--"}，仅统计已写入本地图片目录的文件</span></div></div>
                <div><WifiOff size={18} /><div><strong>同步</strong><span>已建立记录版本、删除墓碑和本机设备编号；当前不连接网络服务。</span></div></div>
              </div>
            </div> : <RecycleBinPanel items={recycleBin} busyId={trashBusyId} error={trashError} onRestore={(item) => void restoreTrash(item)} onRequestDelete={setPendingTrashDelete} onRequestEmpty={() => setPendingTrashDelete("all")} />}
          </div>
        </div>
        {settingsError ? <p className="form-error modal-save-error" role="alert">{settingsError}</p> : null}
        <footer className="modal-footer"><span>{recoveryCode && !recoverySaved ? "请先确认已另行保存新恢复码" : settingsDirty ? "设置有未保存修改" : ""}</span><button className="button button--primary" disabled={busy || Boolean(recoveryCode) && !recoverySaved} onClick={requestClose}>完成</button></footer>
      </Modal>
      {confirmRecoveryRotation ? <Modal title="重新生成恢复码" subtitle="旧恢复码将立即废止" onClose={() => { if (!busy) setConfirmRecoveryRotation(false); }} width="small">
        <div className="modal-body confirm-dialog"><p>生成新恢复码后，旧码将不能再解锁当前软件。已创建的加密备份仍使用创建时的启动密码或恢复码。</p>{rotationError ? <p className="form-error">{rotationError}</p> : null}</div>
        <footer className="modal-footer"><span /><div><button className="button button--quiet" onClick={() => setConfirmRecoveryRotation(false)} disabled={busy}>取消</button><button className="button button--primary" onClick={() => void regenerate()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}确认并生成新恢复码</button></div></footer>
      </Modal> : null}
      {pendingTrashDelete ? <Modal title={pendingTrashDelete === "all" ? "清空回收站" : "永久删除"} subtitle="此操作无法撤销" onClose={() => setPendingTrashDelete(null)} width="small">
        <div className="modal-body confirm-dialog"><p>{pendingTrashDelete === "all" ? `确定永久删除回收站中的 ${recycleBin.length} 个条目及其完整内容吗？` : `确定永久删除“${pendingTrashDelete.label}”及其完整内容吗？`}</p></div>
        <footer className="modal-footer"><span /><div><button className="button button--quiet" onClick={() => setPendingTrashDelete(null)}>取消</button><button className="button button--danger" onClick={() => void confirmTrashDelete()}><Trash2 size={15} />永久删除</button></div></footer>
      </Modal> : null}
      {unsaved.confirmationOpen ? <UnsavedChangesDialog canSave={!templateError} saving={busy} saveError={settingsError} onSave={() => void saveAllAndClose()} onDiscard={unsaved.discardAndClose} onContinue={unsaved.continueEditing} /> : null}
    </>
  );
}
