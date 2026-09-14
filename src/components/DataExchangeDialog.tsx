import { useRef, type ReactNode } from "react";
import {
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Modal } from "./Modal";

export interface DataExchangeDialogProps {
  busyAction: "backup" | "import" | "excel" | "word" | null;
  result: string;
  error: string;
  onClose: () => void;
  onBackup: () => void;
  onImport: (file: File) => void;
  onExportExcel: () => void;
  onExportWord: () => void;
}

type ExchangeAction = DataExchangeDialogProps["busyAction"];

function ActionIcon({ action, busyAction, children }: { action: Exclude<ExchangeAction, null>; busyAction: ExchangeAction; children: ReactNode }) {
  return busyAction === action
    ? <LoaderCircle className="spin" size={17} />
    : children;
}

export default function DataExchangeDialog({ busyAction, result, error, onClose, onBackup, onImport, onExportExcel, onExportWord }: DataExchangeDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const busy = busyAction !== null;
  return (
    <Modal title="数据交换" subtitle="备份、Office 导入与导出集中在这里" onClose={onClose} width="large" closeDisabled={busy}>
      <div className="modal-body exchange-dialog">
        <div className="exchange-warning"><ShieldAlert size={19} /><div><strong>Office 文件包含明文敏感信息</strong><span>Excel 和 Word 会写入明文账号、密码、密保答案及历史密码。仅在需要查看、打印或编辑时导出，并妥善保管文件。</span></div></div>
        <section className="exchange-section">
          <div className="exchange-section__title"><strong>完整备份与恢复</strong><span>加密备份用于迁移和回滚，优先于 Office 文件。</span></div>
          <div className="exchange-actions">
            <button className="exchange-action" disabled={busy} onClick={onBackup}><ActionIcon action="backup" busyAction={busyAction}><Download size={18} /></ActionIcon><div><strong>创建加密备份</strong><span>保存全部数据和图片，可用于完整恢复</span></div></button>
            <button className="exchange-action" disabled={busy} onClick={() => input.current?.click()}><ActionIcon action="import" busyAction={busyAction}><Upload size={18} /></ActionIcon><div><strong>导入数据</strong><span>支持 .anb、.json 和本程序标准 .xlsx</span></div></button>
            <input ref={input} type="file" hidden accept=".anb,.json,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} />
          </div>
        </section>
        <section className="exchange-section">
          <div className="exchange-section__title"><strong>Office 文件</strong><span>Excel 可重新导入；Word 仅用于查看和打印。</span></div>
          <div className="exchange-actions">
            <button className="exchange-action" disabled={busy} onClick={onExportExcel}><ActionIcon action="excel" busyAction={busyAction}><FileSpreadsheet size={18} /></ActionIcon><div><strong>导出标准 Excel</strong><span>完整结构化字段、图片预览和无损图片数据</span></div></button>
            <button className="exchange-action" disabled={busy} onClick={onExportWord}><ActionIcon action="word" busyAction={busyAction}><FileText size={18} /></ActionIcon><div><strong>导出只读 Word</strong><span>按分区和账号排版，适合查看和打印</span></div></button>
          </div>
        </section>
        {error ? <p className="form-error exchange-message" role="alert">{error}</p> : null}
        {result ? <div className="exchange-result"><FileCheck2 size={17} /><span>{result}</span></div> : null}
      </div>
      <footer className="modal-footer"><span>桌面版文件保存到 data/exports 或 data/backups</span><button className="button button--secondary" disabled={busy} onClick={onClose}>关闭</button></footer>
    </Modal>
  );
}
