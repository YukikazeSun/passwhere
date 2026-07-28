import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Pencil,
  Trash2,
  Wrench,
} from "lucide-react";
import type { Category, Id, ServiceRecord, Tag } from "../types";
import { sortByOrder } from "../lib/dataModel";

interface SidebarProps {
  categories: Category[];
  tags: Tag[];
  services: ServiceRecord[];
  selectedCategoryId: Id | "all";
  selectedTagIds: Set<Id>;
  onCategoryChange: (id: Id | "all") => void;
  onTagToggle: (id: Id) => void;
  onCreateCategory: (parentId: Id | null) => void;
  onRenameCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onReorderCategory: (sourceId: Id, targetId: Id) => void;
  onManageTags: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  category: Category | null;
}

export function Sidebar({
  categories,
  tags,
  services,
  selectedCategoryId,
  selectedTagIds,
  onCategoryChange,
  onTagToggle,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategory,
  onManageTags,
}: SidebarProps) {
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<Id>>(() => new Set(categories.map((item) => item.id)));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<Id | null>(null);
  const orderedCategories = useMemo(() => sortByOrder(categories), [categories]);
  const tagUsageCounts = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const service of services) {
      for (const tagId of new Set(service.tagIds)) {
        counts.set(tagId, (counts.get(tagId) || 0) + 1);
      }
    }
    return counts;
  }, [services]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const childrenFor = (parentId: Id | null) => orderedCategories.filter((category) => category.parentId === parentId);
  const directCount = (categoryId: Id) => services.filter((service) => service.categoryId === categoryId).length;
  const totalCount = (categoryId: Id): number => directCount(categoryId)
    + childrenFor(categoryId).reduce((sum, child) => sum + totalCount(child.id), 0);

  const openContextMenu = (event: ReactMouseEvent, category: Category | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 200),
      y: Math.min(event.clientY, window.innerHeight - (category ? 124 : 48)),
      category,
    });
  };

  const renderCategory = (category: Category, depth: number) => {
    const children = childrenFor(category.id);
    const expanded = expandedIds.has(category.id);
    return (
      <div key={category.id}>
        <div
          className={`nav-row-wrap ${selectedCategoryId === category.id ? "is-active" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          data-category-context-menu
          onContextMenu={(event) => openContextMenu(event, category)}
        >
          {children.length ? (
            <button
              className="tree-toggle"
              onClick={() => setExpandedIds((current) => {
                const next = new Set(current);
                next.has(category.id) ? next.delete(category.id) : next.add(category.id);
                return next;
              })}
              title={expanded ? "折叠子分类" : "展开子分类"}
            >
              <ChevronRight className={expanded ? "is-expanded" : ""} size={14} />
            </button>
          ) : <span className="tree-toggle-spacer" />}
          <button
            className="nav-row nav-row--tree"
            onClick={() => onCategoryChange(category.id)}
            draggable
            onDragStart={() => setDraggedCategoryId(category.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedCategoryId && draggedCategoryId !== category.id) onReorderCategory(draggedCategoryId, category.id);
              setDraggedCategoryId(null);
            }}
            onDragEnd={() => setDraggedCategoryId(null)}
          >
            <GripVertical className="category-grip" size={13} />
            <Folder size={17} style={{ color: category.color }} />
            <span>{category.name}</span>
            <span className="nav-count">{totalCount(category.id)}</span>
          </button>
        </div>
        {expanded ? children.map((child) => renderCategory(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <aside className="sidebar" aria-label="分类和标签">
      <div className="sidebar-section">
        <div className="section-heading"><span>分类</span></div>
        <button
          className={`nav-row ${selectedCategoryId === "all" ? "is-active" : ""}`}
          onClick={() => onCategoryChange("all")}
          onContextMenu={(event) => openContextMenu(event, null)}
          data-category-context-menu
        >
          <FolderOpen size={17} />
          <span>全部记录</span>
          <span className="nav-count">{services.length}</span>
        </button>
        {childrenFor(null).map((category) => renderCategory(category, 0))}
        {categories.length === 0 ? <p className="sidebar-hint">右键“全部记录”新建分类</p> : null}
      </div>

      <div className="sidebar-section sidebar-section--tags">
        <div className="section-heading">
          <button className="section-heading__toggle" onClick={() => setTagsExpanded((value) => !value)} aria-expanded={tagsExpanded}>
            <ChevronDown className={tagsExpanded ? "" : "is-collapsed"} size={14} />
            <span>标签</span><small>{selectedTagIds.size || ""}</small>
          </button>
          <button className="icon-button icon-button--small" onClick={onManageTags} title="管理标签"><Wrench size={15} /></button>
        </div>
        {tagsExpanded ? <div className="tag-filter-list">
          {tags.map((tag) => (
            <label key={tag.id} className="tag-filter">
              <input type="checkbox" checked={selectedTagIds.has(tag.id)} onChange={() => onTagToggle(tag.id)} />
              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
              <span className="tag-filter__name">{tag.name}</span>
              <span className="tag-filter__count">（{tagUsageCounts.get(tag.id) || 0}）</span>
            </label>
          ))}
          {tags.length === 0 ? <p className="sidebar-hint">使用扳手添加标签</p> : null}
        </div> : null}
      </div>

      {contextMenu ? (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button onClick={() => { onCreateCategory(contextMenu.category?.id || null); setContextMenu(null); }}>
            <FolderPlus size={15} />{contextMenu.category ? "新建子分类" : "新建顶级分类"}
          </button>
          {contextMenu.category ? <>
            <button onClick={() => { onRenameCategory(contextMenu.category!); setContextMenu(null); }}><Pencil size={15} />重命名与配色</button>
            <button className="is-danger" onClick={() => { onDeleteCategory(contextMenu.category!); setContextMenu(null); }}><Trash2 size={15} />删除分类</button>
          </> : null}
        </div>
      ) : null}
    </aside>
  );
}
