import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import type { AuditEvent } from "../types";
import { useAsyncAction } from "../lib/useAsyncAction";
import { Modal } from "./Modal";

export default function LogsDialog({ logs, onClose, onOpenFile }: { logs: AuditEvent[]; onClose: () => void; onOpenFile: () => Promise<void> }) {
  const [error, setError] = useState("");
  const { busy, runAction } = useAsyncAction<"open">();
  const openFile = async () => {
    setError("");
    try {
      await runAction("open", onOpenFile);
    } catch (reason) {
      setError(`日志文件打开失败：${String(reason)}`);
    }
  };
  return (
    <Modal title="修改日志" subtitle="只记录操作与字段名称，不重复写入密码全文" onClose={onClose} width="large" closeDisabled={busy}>
      <div className="modal-body log-list">{logs.length === 0 ? <div className="editor-empty">还没有修改记录</div> : logs.map((event) => <div key={event.id} className="log-row"><time>{new Date(event.timestamp).toLocaleString("zh-CN", { hour12: false })}</time><strong>{event.action}</strong><span>{event.serviceName}{event.accountLabel ? ` / ${event.accountLabel}` : ""}</span><small>{event.fields.join("、")}</small></div>)}</div>
      {error ? <p className="form-error modal-save-error" role="alert">{error}</p> : null}
      <footer className="modal-footer"><button className="button button--secondary" onClick={() => void openFile()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} 打开日志文件</button><button className="button button--primary" onClick={onClose} disabled={busy}>完成</button></footer>
    </Modal>
  );
}
