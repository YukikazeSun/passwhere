import type { CSSProperties } from "react";
import { GripVertical, Plus, SearchX } from "lucide-react";
import type { AccountRecord, Category, Id, ServiceRecord, Tag } from "../types";
import { formatDateTime, getCategoryPath, type ServiceSearchMatch, type ServiceSearchMatchKind } from "../lib/utils";
import { IconAvatar } from "./IconAvatar";

const MATCH_KIND_LABELS: Record<ServiceSearchMatchKind, string> = {
  service: "分区",
  account: "账号",
  note: "备注",
  category: "分类",
  tag: "标签",
};

interface ServiceListProps {
  services: ServiceRecord[];
  accounts: AccountRecord[];
  categories: Category[];
  tags: Tag[];
  searchMatches: ReadonlyMap<Id, ServiceSearchMatch>;
  searchActive: boolean;
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
  selectedServiceId,
  onSelect,
  onAdd,
  onReorder,
}: ServiceListProps) {
  const tagIndex = new Map(tags.map((tag) => [tag.id, tag]));

  return (
    <section className="service-column" aria-label="软件和网站">
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
          services.map((service) => {
            const serviceAccounts = accounts.filter((account) => account.serviceId === service.id);
            const searchMatch = searchMatches.get(service.id);
            return (
              <button
                key={service.id}
                className={`service-row ${selectedServiceId === service.id ? "is-active" : ""} ${searchMatch ? "is-search-result" : ""}`}
                onClick={() => onSelect(service.id, searchMatch?.accountId)}
                draggable={!searchActive}
                onDragStart={(event) => event.dataTransfer.setData("text/account-notebook-service", service.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("text/account-notebook-service");
                  if (sourceId) onReorder(sourceId, service.id);
                }}
              >
                <GripVertical className="service-row__grip" size={15} aria-hidden="true" />
                <IconAvatar name={service.name} image={service.icon} />
                <span className="service-row__content">
                  <span className="service-row__topline">
                    <strong>{service.name}</strong>
                    <span>{formatDateTime(service.updatedAt)}</span>
                  </span>
                  <span className="service-row__meta">
                    {getCategoryPath(service.categoryId, categories)} · {serviceAccounts.length} 个账号
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
      </div>
    </section>
  );
}
