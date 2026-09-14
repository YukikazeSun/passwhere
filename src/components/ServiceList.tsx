import { useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, GripVertical, Plus, SearchX } from "lucide-react";
import type { AccountRecord, Category, Id, ServiceRecord, Tag } from "../types";
import { createCategoryPathIndex, formatDateTime, getCategoryPath, type ServiceSearchMatch, type ServiceSearchMatchKind } from "../lib/utils";
import { IconAvatar } from "./IconAvatar";

const MATCH_KIND_LABELS: Record<ServiceSearchMatchKind, string> = {
  service: "分区",
  account: "账号",
  note: "备注",
  category: "分类",
  tag: "标签",
};

const SERVICE_RENDER_BATCH_SIZE = 200;

interface ServiceRenderWindow {
  source: ServiceRecord[];
  count: number;
}

interface ServiceListProps {
  services: ServiceRecord[];
  accounts: AccountRecord[];
  categories: Category[];
  tags: Tag[];
  searchMatches: ReadonlyMap<Id, ServiceSearchMatch>;
  searchActive: boolean;
  reorderBusy: boolean;
  selectedServiceId: Id | null;
  onSelect: (id: Id, accountId?: Id | null) => void;
  onAdd: () => void;
  onReorder: (sourceId: Id, targetId: Id) => void;
}

export function ServiceList({
  services,
  accounts,
  categories,
  tags,
  searchMatches,
  searchActive,
  reorderBusy,
  selectedServiceId,
  onSelect,
  onAdd,
  onReorder,
}: ServiceListProps) {
  const [draggedServiceId, setDraggedServiceId] = useState<Id | null>(null);
  const tagIndex = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const accountCountByServiceId = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const account of accounts) {
      counts.set(account.serviceId, (counts.get(account.serviceId) || 0) + 1);
    }
    return counts;
  }, [accounts]);
  const categoryPathById = useMemo(() => createCategoryPathIndex(categories), [categories]);
  const uncategorizedPath = useMemo(() => getCategoryPath(null, []), []);
  const [renderWindow, setRenderWindow] = useState<ServiceRenderWindow>(() => ({
    source: services,
    count: SERVICE_RENDER_BATCH_SIZE,
  }));
  const visibleCount = renderWindow.source === services
    ? renderWindow.count
    : SERVICE_RENDER_BATCH_SIZE;
  const batchServices = services.slice(0, visibleCount);
  const selectedOutsideBatch = selectedServiceId
    ? services.find((service, index) => service.id === selectedServiceId && index >= visibleCount) || null
    : null;
  const visibleServices = selectedOutsideBatch
    ? [selectedOutsideBatch, ...batchServices]
    : batchServices;
  const remainingCount = Math.max(
    0,
    services.length - batchServices.length - (selectedOutsideBatch ? 1 : 0),
  );

  return (
    <section className="service-column" aria-label="软件和网站" aria-busy={reorderBusy}>
      <header className="column-header">
        <div>
          <h2>记录</h2>
          <span>{services.length} 个分区</span>
        </div>
        <button className="icon-button" onClick={onAdd} title="新建软件或网站">
          <Plus size={18} />
        </button>
      </header>

      <div className="service-list">
        {services.length === 0 ? (
          <div className="empty-list">
            <SearchX size={24} />
            <strong>没有匹配记录</strong>
            <span>调整关键词、分类或标签</span>
          </div>
        ) : (
          visibleServices.map((service) => {
            const searchMatch = searchMatches.get(service.id);
            const pinnedSelection = selectedOutsideBatch?.id === service.id;
            return (
              <button
                key={service.id}
                className={`service-row ${selectedServiceId === service.id ? "is-active" : ""} ${searchMatch ? "is-search-result" : ""} ${draggedServiceId === service.id ? "is-dragging" : ""}`}
                onClick={() => onSelect(service.id, searchMatch?.accountId)}
                draggable={!pinnedSelection && !searchActive && !reorderBusy}
                onDragStart={(event) => {
                  if (!pinnedSelection && !reorderBusy) {
                    setDraggedServiceId(service.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/account-notebook-service", service.id);
                    event.dataTransfer.setData("text/plain", `account-notebook-service:${service.id}`);
                  }
                }}
                onDragOver={(event) => {
                  if (!reorderBusy && (event.dataTransfer.types.includes("text/account-notebook-service") || event.dataTransfer.types.includes("text/plain"))) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const customSourceId = event.dataTransfer.getData("text/account-notebook-service");
                  const plainSource = event.dataTransfer.getData("text/plain");
                  const sourceId = customSourceId || (plainSource.startsWith("account-notebook-service:") ? plainSource.slice("account-notebook-service:".length) : "");
                  if (!reorderBusy && sourceId && services.some((item) => item.id === sourceId)) onReorder(sourceId, service.id);
                  setDraggedServiceId(null);
                }}
                onDragEnd={() => setDraggedServiceId(null)}
              >
                <GripVertical className="service-row__grip" size={15} aria-hidden="true" />
                <IconAvatar name={service.name} image={service.icon} />
                <span className="service-row__content">
                  <span className="service-row__topline">
                    <strong>{service.name}</strong>
                    <span>{formatDateTime(service.updatedAt)}</span>
                  </span>
                  <span className="service-row__meta">
                    {service.categoryId ? categoryPathById.get(service.categoryId) : uncategorizedPath} · {accountCountByServiceId.get(service.id) || 0} 个账号
                  </span>
                  {searchMatch ? <span className="service-row__match"><span>{MATCH_KIND_LABELS[searchMatch.kind]}</span><span title={`${searchMatch.label} · ${searchMatch.preview}`}>{searchMatch.label} · {searchMatch.preview}</span></span> : <span className="service-row__tags">
                    {service.tagIds.slice(0, 3).map((tagId) => {
                      const tag = tagIndex.get(tagId);
                      return tag ? (
                        <span key={tag.id} className="mini-tag" style={{ "--tag-color": tag.color } as CSSProperties}>
                          {tag.name}
                        </span>
                      ) : null;
                    })}
                  </span>}
                </span>
              </button>
            );
          })
        )}
        {remainingCount > 0 ? (
          <button
            className="service-list__load-more"
            onClick={() => setRenderWindow({
              source: services,
              count: visibleCount + SERVICE_RENDER_BATCH_SIZE,
            })}
          >
            <ChevronDown size={15} />
            加载更多（还剩 {remainingCount} 条）
          </button>
        ) : null}
      </div>
    </section>
  );
}
