import type {
  AccountDisplayModule,
  AccountRecord,
  AppData,
  Category,
  CustomField,
  PasswordHistoryItem,
  PreparedImport,
  SecurityQuestion,
  ServiceRecord,
  StoredImage,
  Tag,
} from "../types";
import { ALL_ACCOUNT_MODULES, CURRENT_DATA_VERSION } from "./dataModel";
import { prepareImportData } from "./importValidation";

const TEMPLATE_MARKER = "account-notebook-xlsx";
const TEMPLATE_VERSION = 2;
const MEDIA_CHUNK_SIZE = 30_000;
const HEADER_FILL = "334155";
const HEADER_TEXT = "FFFFFF";
const ACCENT_FILL = "E8F1F2";
const BORDER_COLOR = "D8DEE4";

type ExcelWorkbook = import("exceljs").Workbook;
type ExcelWorksheet = import("exceljs").Worksheet;
type ExcelRow = import("exceljs").Row;

interface MediaPayload {
  id: string;
  kind: "service-icon" | "account-image";
  ownerId: string;
  name: string;
  sourceUrl: string;
  dataUrl: string;
}

interface ParsedMedia {
  kind: MediaPayload["kind"];
  ownerId: string;
  image: StoredImage;
}

const text = (value: unknown) => value == null ? "" : String(value);
const numberValue = (value: unknown, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

function splitList(value: string) {
  return value.split(/[;,，；]/).map((item) => item.trim()).filter(Boolean);
}

function cellText(row: ExcelRow, headerMap: Map<string, number>, heading: string) {
  const index = headerMap.get(heading);
  return index ? row.getCell(index).text.trim() : "";
}

function headerMap(sheet: ExcelWorksheet) {
  const result = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => result.set(cell.text.trim(), index));
  return result;
}

function dataRows(sheet: ExcelWorksheet) {
  const rows: ExcelRow[] = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    let hasValue = false;
    row.eachCell((cell) => { if (cell.text.trim()) hasValue = true; });
    if (hasValue) rows.push(row);
  }
  return rows;
}

function requireSheet(workbook: ExcelWorkbook, name: string) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Excel 模板缺少“${name}”工作表`);
  return sheet;
}

function styleSheet(sheet: ExcelWorksheet, widths: number[], rowHeight = 22) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: widths.length } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: HEADER_TEXT }, name: "Microsoft YaHei" };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    row.height = rowHeight;
    row.font = { name: "Microsoft YaHei", size: 10 };
    row.alignment = { vertical: "top", wrapText: true };
  }
  sheet.eachRow((row) => row.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  }));
}

function addTableSheet(workbook: ExcelWorkbook, name: string, headers: string[], rows: unknown[][], widths: number[], rowHeight = 22) {
  const sheet = workbook.addWorksheet(name, { properties: { defaultRowHeight: rowHeight } });
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  styleSheet(sheet, widths, rowHeight);
  return sheet;
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("图片数据格式不正确");
  return { mime: match[1].toLowerCase(), base64: match[2] };
}

function collectMedia(data: AppData): MediaPayload[] {
  return [
    ...data.services.flatMap((service) => service.icon ? [{
      id: service.icon.id,
      kind: "service-icon" as const,
      ownerId: service.id,
      name: service.icon.name,
      sourceUrl: service.icon.sourceUrl || "",
      dataUrl: service.icon.dataUrl,
    }] : []),
    ...data.accounts.flatMap((account) => account.images.map((image) => ({
      id: image.id,
      kind: "account-image" as const,
      ownerId: account.id,
      name: image.name,
      sourceUrl: image.sourceUrl || "",
      dataUrl: image.dataUrl,
    }))),
  ];
}

function previewExtension(mime: string): "png" | "jpeg" | "gif" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/gif") return "gif";
  return null;
}

async function convertDataUrlToPng(dataUrl: string) {
  if (typeof document === "undefined") return null;
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片无法转换为 Office 预览"));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境不支持图片格式转换");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function officePreview(dataUrl: string) {
  const { mime } = parseDataUrl(dataUrl);
  const extension = previewExtension(mime);
  if (extension) return { dataUrl, extension };
  const converted = await convertDataUrlToPng(dataUrl);
  return converted ? { dataUrl: converted, extension: "png" as const } : null;
}

async function addWorkbookImage(workbook: ExcelWorkbook, sheet: ExcelWorksheet, dataUrl: string, row: number, column: number, size: { width: number; height: number }) {
  try {
    const preview = await officePreview(dataUrl);
    if (!preview) return;
    const imageId = workbook.addImage({ base64: preview.dataUrl, extension: preview.extension });
    sheet.addImage(imageId, {
      tl: { col: column - 1 + 0.08, row: row - 1 + 0.08 },
      ext: size,
      editAs: "oneCell",
    });
  } catch {
    // Unsupported preview formats remain available losslessly in the hidden media sheet.
  }
}

export async function exportExcel(data: AppData) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "我密码呢";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "本地账号信息记事本标准交换模板";

  const guide = workbook.addWorksheet("说明", { views: [{ showGridLines: false }] });
  guide.mergeCells("A1:F1");
  guide.getCell("A1").value = "我密码呢 - Excel 数据交换模板";
  guide.getCell("A1").font = { name: "Microsoft YaHei", size: 18, bold: true, color: { argb: HEADER_FILL } };
  guide.getCell("A1").alignment = { vertical: "middle" };
  guide.getRow(1).height = 38;
  const guideLines = [
    ["用途", "用于完整查看、编辑并重新导入我密码呢中的结构化数据。"],
    ["重要", "本工作簿包含明文账号、密码、密保答案、历史密码和图片，请妥善保管。"],
    ["可编辑", "可修改各可见工作表中的文字内容；不要修改工作表名称、列名或记录编号。"],
    ["图片", "可见工作表提供预览；原始图片保存在隐藏工作表中，重新导入时不会因缩略图而降质。"],
    ["导入", "仅支持本程序导出的标准模板。导入前会显示预览，并自动创建加密回滚备份。"],
    ["Word", "Word 仅用于查看和打印，不支持导入。"],
  ];
  guideLines.forEach((line, index) => {
    const row = index + 3;
    guide.getCell(row, 1).value = line[0];
    guide.getCell(row, 1).font = { name: "Microsoft YaHei", bold: true, color: { argb: "0F766E" } };
    guide.getCell(row, 2).value = line[1];
    guide.mergeCells(row, 2, row, 6);
    guide.getCell(row, 2).font = { name: "Microsoft YaHei", size: 10 };
    guide.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    guide.getRow(row).height = row === 4 ? 38 : 30;
  });
  guide.getColumn(1).width = 13;
  for (let column = 2; column <= 6; column += 1) guide.getColumn(column).width = 18;
  guide.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEF3C7" } };
  guide.getCell("B4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEF3C7" } };

  addTableSheet(workbook, "分类", ["分类编号", "分类名称", "上级分类编号", "颜色", "排序"], data.categories.map((item) => [item.id, item.name, item.parentId || "", item.color, item.sortOrder]), [28, 24, 28, 14, 10]);
  addTableSheet(workbook, "标签", ["标签编号", "标签名称", "颜色"], data.tags.map((item) => [item.id, item.name, item.color]), [28, 24, 14]);
  const serviceSheet = addTableSheet(workbook, "分区", ["分区编号", "分区名称", "登录网址", "分类编号", "标签编号", "图标编号", "图标文件名", "图标预览", "创建时间", "更新时间", "排序"], data.services.map((item) => [item.id, item.name, item.url, item.categoryId || "", item.tagIds.join(";"), item.icon?.id || "", item.icon?.name || "", "", item.createdAt, item.updatedAt, item.sortOrder]), [28, 24, 34, 28, 34, 28, 24, 16, 25, 25, 10], 48);
  for (let index = 0; index < data.services.length; index += 1) {
    const service = data.services[index];
    if (service.icon?.dataUrl) await addWorkbookImage(workbook, serviceSheet, service.icon.dataUrl, index + 2, 8, { width: 36, height: 36 });
  }

  addTableSheet(workbook, "账号", ["账号编号", "所属分区编号", "账号名称", "登录账号", "当前密码", "身份识别码", "显示模块", "排序", "创建时间", "更新时间"], data.accounts.map((item) => [item.id, item.serviceId, item.label, item.username, item.password, item.identityCode, item.visibleModules.join(";"), item.sortOrder, item.createdAt, item.updatedAt]), [28, 28, 24, 28, 30, 38, 35, 10, 25, 25], 30);
  addTableSheet(workbook, "历史密码", ["记录编号", "账号编号", "历史密码", "变更时间", "顺序"], data.accounts.flatMap((account) => account.passwordHistory.map((item, index) => [item.id, account.id, item.password, item.changedAt, index])), [28, 28, 32, 25, 10]);
  addTableSheet(workbook, "密保问题", ["记录编号", "账号编号", "问题", "回答", "顺序"], data.accounts.flatMap((account) => account.securityQuestions.map((item, index) => [item.id, account.id, item.question, item.answer, index])), [28, 28, 38, 38, 10], 30);
  addTableSheet(workbook, "自定义字段", ["记录编号", "账号编号", "字段名称", "字段内容", "多行显示", "允许复制", "顺序"], data.accounts.flatMap((account) => account.customFields.map((item, index) => [item.id, account.id, item.label, item.value, item.multiline ? "是" : "否", item.copyable ? "是" : "否", index])), [28, 28, 24, 48, 12, 12, 10], 30);
  addTableSheet(workbook, "备注", ["记录编号", "账号编号", "标题", "内容", "顺序"], data.accounts.flatMap((account) => account.notes.map((item, index) => [item.id, account.id, item.title, item.content, index])), [28, 28, 24, 60, 10], 42);
  const imageSheet = addTableSheet(workbook, "图片", ["图片编号", "账号编号", "文件名", "来源网址", "图片预览", "顺序"], data.accounts.flatMap((account) => account.images.map((item, index) => [item.id, account.id, item.name, item.sourceUrl || "", "", index])), [28, 28, 26, 38, 24, 10], 84);
  let imageRow = 2;
  for (const account of data.accounts) {
    for (const item of account.images) {
      if (item.dataUrl) await addWorkbookImage(workbook, imageSheet, item.dataUrl, imageRow, 5, { width: 104, height: 72 });
      imageRow += 1;
    }
  }

  const mediaSheet = workbook.addWorksheet("_图片数据", { state: "veryHidden" });
  mediaSheet.addRow(["图片编号", "类型", "所有者编号", "文件名", "来源网址", "MIME", "分块序号", "分块总数", "Base64数据"]);
  collectMedia(data).forEach((media) => {
    const parsed = parseDataUrl(media.dataUrl);
    const chunks = Array.from({ length: Math.max(1, Math.ceil(parsed.base64.length / MEDIA_CHUNK_SIZE)) }, (_, index) => parsed.base64.slice(index * MEDIA_CHUNK_SIZE, (index + 1) * MEDIA_CHUNK_SIZE));
    chunks.forEach((chunk, index) => mediaSheet.addRow([media.id, media.kind, media.ownerId, media.name, media.sourceUrl, parsed.mime, index, chunks.length, chunk]));
  });
  const configSheet = workbook.addWorksheet("_配置", { state: "veryHidden" });
  configSheet.addRows([
    ["键", "值"],
    ["template_marker", TEMPLATE_MARKER],
    ["template_version", TEMPLATE_VERSION],
    ["app_data_version", data.version],
    ["exported_at", new Date().toISOString()],
    ["password_template", data.settings.passwordTemplate],
    ["encrypt_images", data.settings.encryptImages ? "true" : "false"],
  ]);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function parseMediaSheet(sheet: ExcelWorksheet): Map<string, ParsedMedia> {
  const headers = headerMap(sheet);
  const groups = new Map<string, { kind: MediaPayload["kind"]; ownerId: string; name: string; sourceUrl: string; mime: string; total: number; chunks: Map<number, string> }>();
  dataRows(sheet).forEach((row) => {
    const id = cellText(row, headers, "图片编号");
    if (!id) return;
    const kind = cellText(row, headers, "类型");
    if (kind !== "service-icon" && kind !== "account-image") throw new Error(`图片“${id}”的类型无效`);
    const current = groups.get(id) || {
      kind,
      ownerId: cellText(row, headers, "所有者编号"),
      name: cellText(row, headers, "文件名"),
      sourceUrl: cellText(row, headers, "来源网址"),
      mime: cellText(row, headers, "MIME"),
      total: numberValue(cellText(row, headers, "分块总数"), 1),
      chunks: new Map<number, string>(),
    };
    current.chunks.set(numberValue(cellText(row, headers, "分块序号")), cellText(row, headers, "Base64数据"));
    groups.set(id, current);
  });
  const result = new Map<string, ParsedMedia>();
  groups.forEach((group, id) => {
    if (!group.ownerId || !group.name || !group.mime || group.chunks.size !== group.total) throw new Error(`图片“${id}”的数据不完整`);
    const base64 = Array.from({ length: group.total }, (_, index) => group.chunks.get(index) ?? "").join("");
    result.set(id, {
      kind: group.kind,
      ownerId: group.ownerId,
      image: { id, name: group.name, sourceUrl: group.sourceUrl || undefined, dataUrl: `data:${group.mime};base64,${base64}` },
    });
  });
  return result;
}

function parseBoolean(value: string) {
  return /^(是|true|1|yes)$/i.test(value.trim());
}

function parseConfig(sheet: ExcelWorksheet) {
  const values = new Map<string, string>();
  dataRows(sheet).forEach((row) => values.set(row.getCell(1).text.trim(), row.getCell(2).text));
  if (values.get("template_marker") !== TEMPLATE_MARKER) throw new Error("该工作簿不是我密码呢标准 Excel 模板");
  if (numberValue(values.get("template_version")) > TEMPLATE_VERSION) throw new Error("Excel 模板版本高于当前程序支持的版本");
  return values;
}

function rowsByOwner<T>(items: Array<T & { ownerId: string; order: number }>) {
  const result = new Map<string, T[]>();
  items.sort((left, right) => left.order - right.order).forEach(({ ownerId, order: _order, ...item }) => {
    result.set(ownerId, [...(result.get(ownerId) || []), item as T]);
  });
  return result;
}

export async function importExcel(bytes: ArrayBuffer, fileName: string, lastModified?: number): Promise<PreparedImport> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const config = parseConfig(requireSheet(workbook, "_配置"));
  const media = parseMediaSheet(requireSheet(workbook, "_图片数据"));
  const importedAt = lastModified ? new Date(lastModified).toISOString() : new Date().toISOString();
  const importedVersion = { revision: 1, updatedAt: importedAt, modifiedByDeviceId: "device-excel-import" };

  const categorySheet = requireSheet(workbook, "分类");
  const categoryHeaders = headerMap(categorySheet);
  const categories: Category[] = dataRows(categorySheet).map((row, index) => ({
    id: cellText(row, categoryHeaders, "分类编号"),
    name: cellText(row, categoryHeaders, "分类名称"),
    parentId: cellText(row, categoryHeaders, "上级分类编号") || null,
    color: cellText(row, categoryHeaders, "颜色") || "#3f6f8f",
    sortOrder: numberValue(cellText(row, categoryHeaders, "排序"), index),
    ...importedVersion,
  }));
  const tagSheet = requireSheet(workbook, "标签");
  const tagHeaders = headerMap(tagSheet);
  const tags: Tag[] = dataRows(tagSheet).map((row) => ({ id: cellText(row, tagHeaders, "标签编号"), name: cellText(row, tagHeaders, "标签名称"), color: cellText(row, tagHeaders, "颜色") || "#6b7280", ...importedVersion }));
  const serviceSheet = requireSheet(workbook, "分区");
  const serviceHeaders = headerMap(serviceSheet);
  const services: ServiceRecord[] = dataRows(serviceSheet).map((row, index) => {
    const id = cellText(row, serviceHeaders, "分区编号");
    const iconId = cellText(row, serviceHeaders, "图标编号");
    const icon = iconId ? media.get(iconId) : undefined;
    if (icon && (icon.kind !== "service-icon" || icon.ownerId !== id)) throw new Error(`分区“${cellText(row, serviceHeaders, "分区名称")}”的图标关联无效`);
    return {
      id,
      name: cellText(row, serviceHeaders, "分区名称"),
      url: cellText(row, serviceHeaders, "登录网址"),
      categoryId: cellText(row, serviceHeaders, "分类编号") || null,
      tagIds: splitList(cellText(row, serviceHeaders, "标签编号")),
      icon: icon?.image || null,
      createdAt: cellText(row, serviceHeaders, "创建时间") || new Date().toISOString(),
      updatedAt: cellText(row, serviceHeaders, "更新时间") || new Date().toISOString(),
      revision: 1,
      modifiedByDeviceId: "device-excel-import",
      sortOrder: numberValue(cellText(row, serviceHeaders, "排序"), index),
    };
  });

  const historySheet = requireSheet(workbook, "历史密码");
  const historyHeaders = headerMap(historySheet);
  const histories = rowsByOwner<PasswordHistoryItem>(dataRows(historySheet).map((row, index) => ({ id: cellText(row, historyHeaders, "记录编号"), ownerId: cellText(row, historyHeaders, "账号编号"), password: cellText(row, historyHeaders, "历史密码"), changedAt: cellText(row, historyHeaders, "变更时间"), order: numberValue(cellText(row, historyHeaders, "顺序"), index) })));
  const securitySheet = requireSheet(workbook, "密保问题");
  const securityHeaders = headerMap(securitySheet);
  const questions = rowsByOwner<SecurityQuestion>(dataRows(securitySheet).map((row, index) => ({ id: cellText(row, securityHeaders, "记录编号"), ownerId: cellText(row, securityHeaders, "账号编号"), question: cellText(row, securityHeaders, "问题"), answer: cellText(row, securityHeaders, "回答"), order: numberValue(cellText(row, securityHeaders, "顺序"), index) })));
  const customSheet = requireSheet(workbook, "自定义字段");
  const customHeaders = headerMap(customSheet);
  const customFields = rowsByOwner<CustomField>(dataRows(customSheet).map((row, index) => ({ id: cellText(row, customHeaders, "记录编号"), ownerId: cellText(row, customHeaders, "账号编号"), label: cellText(row, customHeaders, "字段名称"), value: cellText(row, customHeaders, "字段内容"), multiline: parseBoolean(cellText(row, customHeaders, "多行显示")), copyable: parseBoolean(cellText(row, customHeaders, "允许复制")), order: numberValue(cellText(row, customHeaders, "顺序"), index) })));
  const noteSheet = requireSheet(workbook, "备注");
  const noteHeaders = headerMap(noteSheet);
  const notes = rowsByOwner<{ id: string; title: string; content: string }>(dataRows(noteSheet).map((row, index) => ({ id: cellText(row, noteHeaders, "记录编号"), ownerId: cellText(row, noteHeaders, "账号编号"), title: cellText(row, noteHeaders, "标题"), content: cellText(row, noteHeaders, "内容"), order: numberValue(cellText(row, noteHeaders, "顺序"), index) })));
  const imageSheet = requireSheet(workbook, "图片");
  const imageHeaders = headerMap(imageSheet);
  const images = rowsByOwner<StoredImage>(dataRows(imageSheet).map((row, index) => {
    const id = cellText(row, imageHeaders, "图片编号");
    const ownerId = cellText(row, imageHeaders, "账号编号");
    const item = media.get(id);
    if (!item || item.kind !== "account-image" || item.ownerId !== ownerId) throw new Error(`账号图片“${id || "未编号"}”的数据缺失或关联无效`);
    return { ...item.image, name: cellText(row, imageHeaders, "文件名") || item.image.name, sourceUrl: cellText(row, imageHeaders, "来源网址") || item.image.sourceUrl, ownerId, order: numberValue(cellText(row, imageHeaders, "顺序"), index) };
  }));
  const accountSheet = requireSheet(workbook, "账号");
  const accountHeaders = headerMap(accountSheet);
  const accounts: AccountRecord[] = dataRows(accountSheet).map((row, index) => {
    const id = cellText(row, accountHeaders, "账号编号");
    const visible = splitList(cellText(row, accountHeaders, "显示模块")).filter((item): item is AccountDisplayModule => ALL_ACCOUNT_MODULES.includes(item as AccountDisplayModule));
    return {
      id,
      serviceId: cellText(row, accountHeaders, "所属分区编号"),
      label: cellText(row, accountHeaders, "账号名称"),
      username: cellText(row, accountHeaders, "登录账号"),
      password: cellText(row, accountHeaders, "当前密码"),
      identityCode: cellText(row, accountHeaders, "身份识别码"),
      visibleModules: visible.length ? visible : [...ALL_ACCOUNT_MODULES],
      sortOrder: numberValue(cellText(row, accountHeaders, "排序"), index),
      securityQuestions: questions.get(id) || [],
      customFields: customFields.get(id) || [],
      notes: notes.get(id) || [],
      images: images.get(id) || [],
      passwordHistory: (histories.get(id) || []).slice(0, 3),
      createdAt: cellText(row, accountHeaders, "创建时间") || new Date().toISOString(),
      updatedAt: cellText(row, accountHeaders, "更新时间") || new Date().toISOString(),
      revision: 1,
      modifiedByDeviceId: "device-excel-import",
    };
  });

  return prepareImportData({
    version: CURRENT_DATA_VERSION,
    settings: {
      passwordTemplate: config.get("password_template") || "",
      encryptImages: parseBoolean(config.get("encrypt_images") || "false"),
    },
    categories,
    tags,
    services,
    accounts,
  }, {
    fileName,
    sourceType: "excel",
    createdAt: config.get("exported_at") || (lastModified ? new Date(lastModified).toISOString() : new Date().toISOString()),
  });
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function imageForWord(image: StoredImage) {
  let parsed = parseDataUrl(image.dataUrl);
  const type = parsed.mime === "image/png" ? "png"
    : parsed.mime === "image/jpeg" || parsed.mime === "image/jpg" ? "jpg"
      : parsed.mime === "image/gif" ? "gif"
        : parsed.mime === "image/bmp" ? "bmp"
          : null;
  if (type) return { type, data: decodeBase64(parsed.base64) } as const;
  const converted = await convertDataUrlToPng(image.dataUrl);
  if (!converted) return null;
  parsed = parseDataUrl(converted);
  return { type: "png" as const, data: decodeBase64(parsed.base64) };
}

export async function exportWord(data: AppData) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");
  const categoryById = new Map(data.categories.map((item) => [item.id, item.name]));
  const tagById = new Map(data.tags.map((item) => [item.id, item.name]));
  const paragraphs: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  paragraphs.push(new Paragraph({
    text: "我密码呢账号信息导出",
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
  }));
  paragraphs.push(new Paragraph({ children: [new TextRun({ text: `导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`, color: "64748B", size: 19 })], spacing: { after: 120 } }));
  paragraphs.push(new Paragraph({ children: [new TextRun({ text: "注意：本文档包含明文账号、密码、密保答案和历史密码，请妥善保管。", bold: true, color: "9A3412", size: 20 })], spacing: { after: 260 } }));

  const fieldTable = (rows: Array<[string, string]>) => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2100, 7260],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
    },
    rows: rows.map(([label, value]) => new TableRow({ children: [
      new TableCell({ width: { size: 2100, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: ACCENT_FILL }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: "334155", size: 19 })] })] }),
      new TableCell({ width: { size: 7260, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: value || "-", size: 19 })] })] }),
    ] })),
  });

  for (let serviceIndex = 0; serviceIndex < data.services.length; serviceIndex += 1) {
    const service = data.services[serviceIndex];
    paragraphs.push(new Paragraph({
      text: service.name,
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: serviceIndex > 0,
      spacing: { before: 180, after: 100 },
    }));
    const metaRows: Array<[string, string]> = [
      ["分类", service.categoryId ? categoryById.get(service.categoryId) || "未分类" : "未分类"],
      ["标签", service.tagIds.map((id) => tagById.get(id)).filter(Boolean).join("、") || "-"],
    ];
    paragraphs.push(fieldTable(metaRows));
    if (service.url) paragraphs.push(new Paragraph({ children: [new TextRun({ text: "登录网址：", bold: true }), new ExternalHyperlink({ link: service.url, children: [new TextRun({ text: service.url, style: "Hyperlink" })] })], spacing: { before: 100, after: 100 } }));
    const icon = service.icon ? await imageForWord(service.icon) : null;
    if (icon && service.icon) paragraphs.push(new Paragraph({ children: [new ImageRun({ data: icon.data, transformation: { width: 52, height: 52 }, type: icon.type, altText: { title: service.icon.name, description: `${service.name} 分区图标`, name: service.icon.name } })], spacing: { after: 100 } }));

    const accounts = data.accounts.filter((account) => account.serviceId === service.id).sort((left, right) => left.sortOrder - right.sortOrder);
    if (!accounts.length) paragraphs.push(new Paragraph({ children: [new TextRun({ text: "暂无账号记录", italics: true, color: "64748B" })] }));
    for (const account of accounts) {
      paragraphs.push(new Paragraph({ text: account.label, heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 }, keepNext: true }));
      paragraphs.push(fieldTable([
        ["登录账号", account.username],
        ["当前密码", account.password],
        ["身份识别码", account.identityCode],
      ]));
      if (account.securityQuestions.length) {
        paragraphs.push(new Paragraph({ text: "密保问题", heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }));
        paragraphs.push(fieldTable(account.securityQuestions.flatMap((item, index) => [[`问题 ${index + 1}`, item.question], ["回答", item.answer]])));
      }
      if (account.customFields.length) {
        paragraphs.push(new Paragraph({ text: "自定义字段", heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }));
        paragraphs.push(fieldTable(account.customFields.map((item) => [item.label || "未命名字段", item.value])));
      }
      if (account.notes.length) {
        paragraphs.push(new Paragraph({ text: "备注", heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }));
        account.notes.forEach((note) => paragraphs.push(new Paragraph({ children: [new TextRun({ text: `${note.title || "备注"}：`, bold: true }), new TextRun({ text: note.content || "-" })], spacing: { after: 70 } })));
      }
      if (account.passwordHistory.length) {
        paragraphs.push(new Paragraph({ text: "历史密码", heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }));
        paragraphs.push(fieldTable(account.passwordHistory.map((item, index) => [`历史 ${index + 1} · ${item.changedAt}`, item.password])));
      }
      const wordImages = await Promise.all(account.images.map(async (image) => ({ image, payload: await imageForWord(image) })));
      if (wordImages.length) {
        paragraphs.push(new Paragraph({ text: "图片", heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }));
        wordImages.forEach(({ image, payload }) => {
          if (!payload) return;
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: image.name, bold: true, size: 19 })], spacing: { before: 80, after: 40 }, keepNext: true }));
          paragraphs.push(new Paragraph({ children: [new ImageRun({ data: payload.data, transformation: { width: 420, height: 260 }, type: payload.type, altText: { title: image.name, description: `${account.label} 的账号图片`, name: image.name } })], spacing: { after: 100 } }));
          if (image.sourceUrl) paragraphs.push(new Paragraph({ children: [new ExternalHyperlink({ link: image.sourceUrl, children: [new TextRun({ text: image.sourceUrl, style: "Hyperlink", size: 18 })] })], spacing: { after: 80 } }));
        });
      }
    }
  }

  const document = new Document({
    creator: "我密码呢",
    title: "我密码呢账号信息导出",
    styles: {
      default: { document: { run: { font: "Microsoft YaHei", size: 20, color: "1F2937" }, paragraph: { spacing: { after: 100, line: 300 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 36, bold: true, color: "1F2937" }, paragraph: { spacing: { after: 120 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 30, bold: true, color: "0F766E" }, paragraph: { spacing: { before: 300, after: 120 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 25, bold: true, color: "334155" }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 21, bold: true, color: "475569" }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
        },
      },
      children: paragraphs,
    }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}
