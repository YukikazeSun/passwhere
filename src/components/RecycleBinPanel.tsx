import {
  FolderTree,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  Tags,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Id, RecycleBinItem } from "../types";
import { RECYCLE_BIN_TYPE_LABEL } from "../lib/recycleBin";

const typeMeta = {
  category: { label: RECYCLE_BIN_TYPE_LABEL.category, icon: FolderTree },
  tag: { label: RECYCLE_BIN_TYPE_LABEL.tag, icon: Tags },
  service: { label: RECYCLE_BIN_TYPE_LABEL.service, icon: KeyRound },
  account: { label: RECYCLE_BIN_TYPE_LABEL.account, icon: UserRound },
} as const;

function itemSummary(item: RecycleBinItem) {
  if (item.type === "category") {
    return `${item.childCategoryIds.length} 个子分类 · ${item.serviceIds.length} 个分区`;
  }
  if (item.type === "tag") return `${item.serviceIds.length} 个原引用分区`;
  if (item.type === "service") return `${item.accounts.length} 个账号`;
  return `原分区：${item.serviceName}`;
}

export function RecycleBinPanel({
  items,
  busyId,
  error,
  onRestore,
  onRequestDelete,
  onRequestEmpty,
}: {
  items: RecycleBinItem[];
  busyId: Id | "all" | null;
  error: string;
  onRestore: (item: RecycleBinItem) => void;
  onRequestDelete: (item: RecycleBinItem) => void;
  onRequestEmpty: () => void;
}) {
  return (
    <div className="recycle-bin-panel">
      <div className="settings-data-toolbar">
        <div><strong>已删除条目</strong><span>完整内容保存在加密数据中，恢复后回到原位置</span></div>
        <button type="button" className="button button--quiet button--danger-text" onClick={onRequestEmpty} disabled={!items.length || busyId !== null}><Trash2 size={14} />清空</button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {items.length ? <div className="recycle-bin-list">
        {items.map((item) => {
          const meta = typeMeta[item.type];
          const Icon = meta.icon;
          const busy = busyId === item.id;
          return <div className="recycle-bin-row" key={item.id}>
            <div className={`recycle-bin-type recycle-bin-type--${item.type}`} title={meta.label}><Icon size={16} /></div>
            <div className="recycle-bin-copy">
              <strong>{item.label}</strong>
              <span>{meta.label} · {itemSummary(item)}</span>
              <time dateTime={item.deletedAt}>{new Date(item.deletedAt).toLocaleString("zh-CN", { hour12: false })}</time>
            </div>
            <div className="recycle-bin-actions">
              <button type="button" className="icon-button icon-button--small" title={`恢复${meta.label}“${item.label}”`} onClick={() => onRestore(item)} disabled={busyId !== null}>{busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}</button>
              <button type="button" className="icon-button icon-button--small icon-button--danger" title={`永久删除${meta.label}“${item.label}”`} onClick={() => onRequestDelete(item)} disabled={busyId !== null}><Trash2 size={15} /></button>
            </div>
          </div>;
        })}
      </div> : <div className="recycle-bin-empty"><Trash2 size={24} /><strong>回收站是空的</strong><span>删除的分类、标签、分区和账号会显示在这里</span></div>}
    </div>
  );
}
