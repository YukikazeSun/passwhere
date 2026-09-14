import { useState } from "react";
import {
  FileCheck2,
  FolderOpen,
  HardDrive,
  Images,
  KeyRound,
  Layers3,
  LoaderCircle,
  ShieldCheck,
  Tags,
  Users,
} from "lucide-react";
import type { ImportCounts, PreparedImport } from "../types";
import { Modal } from "./Modal";

export function BackupCredentialDialog({ onClose, onSubmit, kind = "startup" }: { onClose: () => void; onSubmit: (credential: string) => Promise<void>; kind?: "startup" | "export" }) {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isExport = kind === "export";
  return (
    <Modal title={isExport ? "输入备份密码" : "解锁备份"} subtitle={isExport ? "输入创建导出备份时设置的独立密码" : "输入创建备份时使用的启动密码或恢复码"} onClose={onClose} width="small" closeDisabled={busy}>
      <form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(""); void onSubmit(credential).catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }}>
        <div className="modal-body form-stack"><label className="form-field"><span>{isExport ? "备份密码" : "密码或恢复码"}</span><input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} /></label>{error ? <p className="form-error">{error}</p> : null}</div>
        <footer className="modal-footer"><span /><div><button type="button" className="button button--quiet" onClick={onClose} disabled={busy}>取消</button><button className="button button--primary" disabled={!credential || busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />} 解锁并导入</button></div></footer>
      </form>
    </Modal>
  );
}

export function BackupExportCredentialDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (credential: string) => Promise<void> }) {
  const [credential, setCredential] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (credential.length < 8) {
      setError("备份密码至少需要 8 个字符");
      return;
    }
    if (credential !== confirmation) {
      setError("两次输入的备份密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    void onSubmit(credential).catch((reason) => setError(String(reason))).finally(() => setBusy(false));
  };
  return (
    <Modal title="设置备份密码" subtitle="启动锁未开启，导出文件需要单独的密码保护" onClose={onClose} width="small" closeDisabled={busy}>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="modal-body form-stack">
          <p>备份密码不会保存到本机配置。忘记后无法恢复该导出文件，请另行保存。</p>
          <label className="form-field"><span>备份密码</span><input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="new-password" placeholder="至少 8 个字符" /></label>
          <label className="form-field"><span>再次输入</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer className="modal-footer"><button type="button" className="button button--quiet" onClick={onClose} disabled={busy}>取消</button><button className="button button--primary" disabled={busy || !credential || !confirmation}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}创建加密备份</button></footer>
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
    <Modal title="确认导入备份" subtitle="核对内容后再替换当前数据" onClose={onClose} width="medium" closeDisabled={busy}>
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
