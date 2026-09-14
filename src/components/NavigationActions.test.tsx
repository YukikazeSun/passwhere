import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Category, ServiceRecord } from "../types";
import { ServiceList } from "./ServiceList";
import { Sidebar } from "./Sidebar";

const timestamp = "2026-07-30T00:00:00.000Z";
const category: Category = {
  id: "category-1",
  name: "工作",
  parentId: null,
  color: "#3f6f8f",
  sortOrder: 0,
  revision: 0,
  updatedAt: timestamp,
  modifiedByDeviceId: "device",
};
const service: ServiceRecord = {
  id: "service-1",
  name: "示例",
  url: "",
  categoryId: category.id,
  tagIds: [],
  icon: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  sortOrder: 0,
  revision: 0,
  modifiedByDeviceId: "device",
};

describe("navigation mutation feedback", () => {
  it("disables category dragging while a navigation mutation is running", () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        categories={[category]}
        tags={[]}
        services={[service]}
        accounts={[]}
        selectedCategoryId="all"
        selectedTagIds={new Set()}
        onCategoryChange={vi.fn()}
        onTagToggle={vi.fn()}
        onCreateCategory={vi.fn()}
        onRenameCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategory={vi.fn()}
        onManageTags={vi.fn()}
        mutationBusy
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain('draggable="true"');
  });

  it("disables service dragging while reordering is being saved", () => {
    const render = (reorderBusy: boolean) => renderToStaticMarkup(
      <ServiceList
        services={[service]}
        accounts={[]}
        categories={[category]}
        tags={[]}
        searchMatches={new Map()}
        searchActive={false}
        reorderBusy={reorderBusy}
        selectedServiceId={service.id}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(render(true)).not.toContain('draggable="true"');
    expect(render(false)).toContain('draggable="true"');
  });

  it("renders large service collections in bounded batches", () => {
    const largeServices = Array.from({ length: 205 }, (_, index) => ({
      ...service,
      id: `service-${index}`,
      name: `Service ${index}`,
      sortOrder: index,
    }));
    const markup = renderToStaticMarkup(
      <ServiceList
        services={largeServices}
        accounts={[]}
        categories={[category]}
        tags={[]}
        searchMatches={new Map()}
        searchActive={false}
        reorderBusy={false}
        selectedServiceId={largeServices[0].id}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(markup.match(/class="service-row /g)).toHaveLength(200);
    expect(markup).toContain("加载更多（还剩 5 条）");
  });

  it("keeps an out-of-batch selection visible without making it draggable", () => {
    const largeServices = Array.from({ length: 205 }, (_, index) => ({
      ...service,
      id: `service-${index}`,
      name: `Service ${index}`,
      sortOrder: index,
    }));
    const markup = renderToStaticMarkup(
      <ServiceList
        services={largeServices}
        accounts={[]}
        categories={[category]}
        tags={[]}
        searchMatches={new Map()}
        searchActive={false}
        reorderBusy={false}
        selectedServiceId="service-204"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    expect(markup.match(/class="service-row /g)).toHaveLength(201);
    expect(markup).toContain("Service 204");
    expect(markup).toContain("加载更多（还剩 4 条）");
  });

  it("aggregates category counts through nested descendants", () => {
    const child = { ...category, id: "category-child", name: "Child", parentId: category.id, sortOrder: 1 };
    const nestedServices = [
      service,
      { ...service, id: "service-2", categoryId: child.id },
      { ...service, id: "service-3", categoryId: child.id },
    ];
    const markup = renderToStaticMarkup(
      <Sidebar
        categories={[{ ...category, name: "Parent" }, child]}
        tags={[]}
        services={nestedServices}
        accounts={[]}
        selectedCategoryId="all"
        selectedTagIds={new Set()}
        onCategoryChange={vi.fn()}
        onTagToggle={vi.fn()}
        onCreateCategory={vi.fn()}
        onRenameCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onReorderCategory={vi.fn()}
        onManageTags={vi.fn()}
        mutationBusy={false}
      />,
    );

    expect(markup).toContain('<span>Parent</span><span class="nav-count">3</span>');
    expect(markup).toContain('<span>Child</span><span class="nav-count">2</span>');
  });
});
