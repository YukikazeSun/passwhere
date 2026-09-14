import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
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
import type { AccountRecord, Category, Id, ServiceRecord, Tag } from "../types";
import { sortByOrder } from "../lib/dataModel";
import { countTagUsage } from "../lib/tagRules";

interface SidebarProps {
  categories: Category[];
  tags: Tag[];
  services: ServiceRecord[];
  accounts: AccountRecord[];
  selectedCategoryId: Id | "all";
  selectedTagIds: Set<Id>;
  onCategoryChange: (id: Id | "all") => void;
  onTagToggle: (id: Id) => void;
  onCreateCategory: (parentId: Id | null) => void;
  onRenameCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onReorderCategory: (sourceId: Id, targetId: Id) => void;
  onManageTags: () => void;
  mutationBusy: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  category: Category | null;
}

export function CategoryContextMenu({ contextMenu, mutationBusy, onClose, onCreateCategory, onRenameCategory, onDeleteCategory }: {
  contextMenu: ContextMenuState;
  mutationBusy: boolean;
  onClose: () => void;
  onCreateCategory: (parentId: Id | null) => void;
  onRenameCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || [])];
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[nextIndex].focus();
  };

  return (
    <div ref={menuRef} className="context-menu" role="menu" aria-label={contextMenu.category ? `${contextMenu.category.name} 分类操作` : "全部记录操作"} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <button type="button" role="menuitem" onClick={() => { onCreateCategory(contextMenu.category?.id || null); onClose(); }}>
        <FolderPlus size={15} />{contextMenu.category ? "新建子分类" : "新建顶级分类"}
      </button>
      {contextMenu.category ? <>
        <button type="button" role="menuitem" onClick={() => { onRenameCategory(contextMenu.category!); onClose(); }}><Pencil size={15} />重命名与配色</button>
        <button type="button" role="menuitem" className="is-danger" disabled={mutationBusy} onClick={() => { onDeleteCategory(contextMenu.category!); onClose(); }}><Trash2 size={15} />删除分类</button>
      </> : null}
    </div>
  );
}

export function Sidebar({
  categories,
  tags,
  services,
  accounts,
  selectedCategoryId,
  selectedTagIds,
  onCategoryChange,
  onTagToggle,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategory,
  onManageTags,
  mutationBusy,
}: SidebarProps) {
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<Id>>(() => new Set(categories.map((item) => item.id)));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<Id | null>(null);
  const orderedCategories = useMemo(() => sortByOrder(categories), [categories]);
  const categoryTree = useMemo(() => {
    const childrenByParentId = new Map<Id | null, Category[]>();
    for (const category of orderedCategories) {
      const children = childrenByParentId.get(category.parentId);
      if (children) children.push(category);
      else childrenByParentId.set(category.parentId, [category]);
    }

    const directCountById = new Map<Id, number>();
    for (const service of services) {
      if (!service.categoryId) continue;
      directCountById.set(service.categoryId, (directCountById.get(service.categoryId) || 0) + 1);
    }

    const totalCountById = new Map<Id, number>();
    const countCategory = (categoryId: Id, visiting: Set<Id>): number => {
      const cached = totalCountById.get(categoryId);
      if (cached !== undefined) return cached;
      if (visiting.has(categoryId)) return 0;
      visiting.add(categoryId);
      const total = (directCountById.get(categoryId) || 0)
        + (childrenByParentId.get(categoryId) || [])
          .reduce((sum, child) => sum + countCategory(child.id, visiting), 0);
      visiting.delete(categoryId);
      totalCountById.set(categoryId, total);
      return total;
    };
    for (const category of orderedCategories) countCategory(category.id, new Set());
    return { childrenByParentId, totalCountById };
  }, [orderedCategories, services]);
  const tagUsageCounts = useMemo(() => countTagUsage(services), [services]);

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

  const childrenFor = (parentId: Id | null) => categoryTree.childrenByParentId.get(parentId) || [];

  const openContextMenu = (event: ReactMouseEvent, category: Category | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (mutationBusy) return;
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
            className={`nav-row nav-row--tree ${draggedCategoryId === category.id ? "is-dragging" : ""}`}
            onClick={() => onCategoryChange(category.id)}
            draggable={!mutationBusy}
            onDragStart={(event) => {
              if (mutationBusy) return;
              setDraggedCategoryId(category.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/account-notebook-category", category.id);
              event.dataTransfer.setData("text/plain", `account-notebook-category:${category.id}`);
            }}
            onDragOver={(event) => {
              if (!mutationBusy && (event.dataTransfer.types.includes("text/account-notebook-category") || event.dataTransfer.types.includes("text/plain"))) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const customSourceId = event.dataTransfer.getData("text/account-notebook-category");
              const plainSource = event.dataTransfer.getData("text/plain");
              const sourceId = customSourceId || (plainSource.startsWith("account-notebook-category:") ? plainSource.slice("account-notebook-category:".length) : "") || draggedCategoryId;
              if (!mutationBusy && sourceId && sourceId !== category.id) onReorderCategory(sourceId, category.id);
              setDraggedCategoryId(null);
            }}
            onDragEnd={() => setDraggedCategoryId(null)}
          >
            <GripVertical className="category-grip" size={13} />
            <Folder size={17} style={{ color: category.color }} />
            <span>{category.name}</span>
            <span className="nav-count">{categoryTree.totalCountById.get(category.id) || 0}</span>
          </button>
        </div>
        {expanded ? children.map((child) => renderCategory(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <aside className="sidebar" aria-label="分类和标签" aria-busy={mutationBusy}>
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
              <span className="tag-filter__count">（{tagUsageCounts[tag.id] || 0}）</span>
            </label>
          ))}
          {tags.length === 0 ? <p className="sidebar-hint">使用扳手添加标签</p> : null}
        </div> : null}
      </div>

      {contextMenu ? <CategoryContextMenu contextMenu={contextMenu} mutationBusy={mutationBusy} onClose={() => setContextMenu(null)} onCreateCategory={onCreateCategory} onRenameCategory={onRenameCategory} onDeleteCategory={onDeleteCategory} /> : null}
    </aside>
  );
}
