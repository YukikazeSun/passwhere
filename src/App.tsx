import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BookKey,
  Database,
  FileClock,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import type { AccountRecord, AppData, AppSettings, AuditEvent, Category, Id, ImportCounts, PreparedImport, SecurityStatus, ServiceRecord, Tag } from "./types";
import { Sidebar } from "./components/Sidebar";
import { ServiceList } from "./components/ServiceList";
import { AccountDetail } from "./components/AccountDetail";
import { AccountManager } from "./components/AccountManager";
import {
  BackupCredentialDialog,
  CategoryEditor,
  DataExchangeDialog,
  ImagePreview,
  ImportPreviewDialog,
  ImportResultDialog,
  LockScreen,
  LogsDialog,
  PasswordDecision,
  ServiceEditor,
  SettingsDialog,
  TagManager,
} from "./components/Dialogs";
import {
  appendAudit,
  changeStartupPassword,
  createRollbackBackup,
  decryptBackup,
  disableStartupLock,
  enableStartupLock,
  exportBackup,
  getSecurityStatus,
  getSyncLocalState,
  getStorageStats,
  inspectBackup,
  loadAppData,
  lockVault,
  openAuditLog,
  openExternal,
  readAuditLogs,
  regenerateRecoveryCode,
  revealDataDirectory,
  saveOfficeExport,
  saveAppData,
  unlockVault,
} from "./lib/storage";
import { updatePasswordHistory } from "./lib/passwordHistory";
import { createId, findServiceSearchResults, nowIso, validateExternalUrl, type ServiceSearchMatch } from "./lib/utils";
import { moveItem, sortByOrder, withSortOrder } from "./lib/dataModel";
import { prepareImportData } from "./lib/importValidation";
import { replaceDataWithRollback, SafeImportError } from "./lib/safeImport";
import { countTagUsage, validateTags } from "./lib/tagRules";
import { describeAccountChanges, describeServiceChanges, describeTagCollectionChanges } from "./lib/audit";
import { exportExcel, exportWord, importExcel } from "./lib/officeExchange";
import { prepareLocalMutation } from "./lib/revisions";
import type { SyncLocalState } from "./lib/sync";

type EditorState =
  | { type: "service"; service: ServiceRecord | null }
  | { type: "accounts" }
  | { type: "category"; category: Category | null; parentId: Id | null }
  | { type: "tags" }
  | { type: "settings" }
  | { type: "exchange" }
  | { type: "logs" }
  | null;

interface PendingPasswordBatch {
  originals: AccountRecord[];
  drafts: AccountRecord[];
  changedIds: Id[];
  currentIndex: number;
}

interface ToastMessage {
  id: string;
  message: string;
  tone: "success" | "error" | "neutral";
}

interface ProtectedBackup {
  text: string;
  fileName: string;
  createdAt: string;
}

interface ImportResultState {
  rollbackPath: string;
  counts: ImportCounts;
}

export default function App() {
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [syncLocal, setSyncLocal] = useState<SyncLocalState | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [bootError, setBootError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedCategoryId, setSelectedCategoryId] = useState<Id | "all">("all");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<Id>>(() => new Set());
  const [selectedServiceId, setSelectedServiceId] = useState<Id | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<Id | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingPasswordBatch, setPendingPasswordBatch] = useState<PendingPasswordBatch | null>(null);
  const [protectedBackup, setProtectedBackup] = useState<ProtectedBackup | null>(null);
  const [pendingImport, setPendingImport] = useState<PreparedImport | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);
  const [exchangeBusy, setExchangeBusy] = useState<"backup" | "import" | "excel" | "word" | null>(null);
  const [exchangeResult, setExchangeResult] = useState("");
  const [exchangeError, setExchangeError] = useState("");
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const lastLocatedSearch = useRef("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getSecurityStatus(), getSyncLocalState()])
      .then(async ([status, localSync]) => {
        if (cancelled) return;
        setSecurity(status);
        setSyncLocal(localSync);
        if (status.unlocked) {
          const loaded = await loadAppData(localSync.deviceId);
          if (!cancelled) applyLoadedData(loaded);
        }
      })
      .catch((error) => !cancelled && setBootError(String(error)));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const disableUnusedContextMenus = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-category-context-menu]")) return;
      event.preventDefault();
    };
    window.addEventListener("contextmenu", disableUnusedContextMenus);
    return () => window.removeEventListener("contextmenu", disableUnusedContextMenus);
  }, []);

  const searchView = useMemo(() => {
    if (!data) return { services: [], matches: new Map<Id, ServiceSearchMatch>() };
    const results = findServiceSearchResults(
      data.services,
      data.accounts,
      data.categories,
      data.tags,
      deferredSearch,
      selectedCategoryId,
      selectedTagIds,
    );
    return {
      services: results.map((result) => result.service),
      matches: new Map(results.flatMap((result) => result.match ? [[result.service.id, result.match] as const] : [])),
    };
  }, [data, deferredSearch, selectedCategoryId, selectedTagIds]);
  const filteredServices = searchView.services;

  useEffect(() => {
    if (!data) return;
    if (!filteredServices.length) {
      setSelectedServiceId(null);
      setSelectedAccountId(null);
      return;
    }
    const normalizedSearch = deferredSearch.trim().toLocaleLowerCase("zh-CN");
    if (normalizedSearch !== lastLocatedSearch.current) {
      lastLocatedSearch.current = normalizedSearch;
      if (normalizedSearch) {
        const first = filteredServices[0];
        setSelectedServiceId(first.id);
        setSelectedAccountId(searchView.matches.get(first.id)?.accountId
          || data.accounts.find((account) => account.serviceId === first.id)?.id
          || null);
        return;
      }
    }
    if (!filteredServices.some((service) => service.id === selectedServiceId)) {
      const first = filteredServices[0];
      setSelectedServiceId(first.id);
      setSelectedAccountId(searchView.matches.get(first.id)?.accountId
        || data.accounts.find((account) => account.serviceId === first.id)?.id
        || null);
    }
  }, [data, deferredSearch, filteredServices, searchView.matches, selectedServiceId]);

  function applyLoadedData(loaded: AppData) {
    setData(loaded);
    const firstService = sortByOrder(loaded.services)[0];
    setSelectedServiceId(firstService?.id || null);
    setSelectedAccountId(loaded.accounts.find((account) => account.serviceId === firstService?.id)?.id || null);
  }

  function showToast(message: string, tone: ToastMessage["tone"] = "success") {
    const id = createId("toast");
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3000);
  }

  async function handleUnlock(credential: string) {
    setUnlockBusy(true);
    setUnlockError("");
    try {
      const result = await unlockVault(credential);
      if (!syncLocal) throw new Error("本机设备编号尚未就绪");
      const [status, loaded] = await Promise.all([getSecurityStatus(), loadAppData(syncLocal.deviceId)]);
      setSecurity(status);
      applyLoadedData(loaded);
      if (result.unlockedViaRecovery) setEditor({ type: "settings" });
    } catch (error) {
      setUnlockError(String(error));
    } finally {
      setUnlockBusy(false);
    }
  }

  async function persist(nextData: AppData, events?: AuditEvent | AuditEvent[], successMessage = "已保存") {
    const previous = data;
    if (!previous || !syncLocal) {
      showToast("保存失败：本机设备编号尚未就绪", "error");
      return false;
    }
    const versionedData = prepareLocalMutation(previous, nextData, syncLocal.deviceId);
    setData(versionedData);
    try {
      await saveAppData(versionedData);
    } catch (error) {
      if (previous) setData(previous);
      showToast(`保存失败：${String(error)}`, "error");
      return false;
    }
    const auditEvents = events ? (Array.isArray(events) ? events : [events]) : [];
    try {
      for (const event of auditEvents) await appendAudit(event);
    } catch (error) {
      showToast(`数据已保存，但日志写入失败：${String(error)}`, "neutral");
      return true;
    }
    showToast(successMessage);
    return true;
  }

  function makeEvent(action: AuditEvent["action"], serviceName: string, fields: string[], accountLabel?: string): AuditEvent {
    return { id: createId("log"), timestamp: nowIso(), serviceName, accountLabel, action, fields };
  }

  function selectService(id: Id, accountId?: Id | null) {
    setSelectedServiceId(id);
    const matchedAccount = accountId && data?.accounts.some((account) => account.id === accountId && account.serviceId === id)
      ? accountId
      : null;
    setSelectedAccountId(matchedAccount || data?.accounts.find((account) => account.serviceId === id)?.id || null);
  }

  function saveService(service: ServiceRecord) {
    if (!data) return;
    const previous = data.services.find((item) => item.id === service.id);
    const exists = Boolean(previous);
    const normalizedService = exists ? service : { ...service, sortOrder: data.services.length };
    const nextData = {
      ...data,
      services: exists
        ? data.services.map((item) => item.id === service.id ? normalizedService : item)
        : [...data.services, normalizedService],
    };
    setSelectedServiceId(service.id);
    setEditor(null);
    const fields = describeServiceChanges(previous, normalizedService);
    void persist(nextData, fields.length ? makeEvent(exists ? "修改" : "新增", service.name, fields) : undefined, exists ? "分区已更新" : "分区已创建");
  }

  function deleteService(service: ServiceRecord) {
    if (!data) return;
    const accountCount = data.accounts.filter((account) => account.serviceId === service.id).length;
    if (!window.confirm(`删除“${service.name}”及其 ${accountCount} 个账号？此操作无法撤销。`)) return;
    const nextData = {
      ...data,
      services: data.services.filter((item) => item.id !== service.id),
      accounts: data.accounts.filter((account) => account.serviceId !== service.id),
    };
    setEditor(null);
    setSelectedServiceId(nextData.services[0]?.id || null);
    setSelectedAccountId(nextData.accounts.find((account) => account.serviceId === nextData.services[0]?.id)?.id || null);
    void persist(nextData, makeEvent("删除", service.name, ["分区", `${accountCount} 个账号`]), "分区已删除");
  }

  function saveCategory(category: Category) {
    if (!data) return;
    const exists = data.categories.some((item) => item.id === category.id);
    const saved = exists ? category : { ...category, sortOrder: data.categories.length };
    const next = {
      ...data,
      categories: exists
        ? data.categories.map((item) => item.id === saved.id ? saved : item)
        : [...data.categories, saved],
    };
    setEditor(null);
    void persist(next, makeEvent(exists ? "修改" : "新增", saved.name, ["分类"]), exists ? "分类已更新" : "分类已创建");
  }

  function deleteCategory(category: Category) {
    if (!data) return;
    const childCount = data.categories.filter((item) => item.parentId === category.id).length;
    const serviceCount = data.services.filter((item) => item.categoryId === category.id).length;
    if (!window.confirm(`删除分类“${category.name}”？其中 ${serviceCount} 个记录和 ${childCount} 个子分类将移动到上一级。`)) return;
    const next = {
      ...data,
      categories: data.categories
        .filter((item) => item.id !== category.id)
        .map((item) => item.parentId === category.id ? { ...item, parentId: category.parentId } : item),
      services: data.services.map((item) => item.categoryId === category.id ? { ...item, categoryId: category.parentId } : item),
    };
    if (selectedCategoryId === category.id) setSelectedCategoryId(category.parentId || "all");
    void persist(next, makeEvent("删除", category.name, ["分类"]), "分类已删除");
  }

  function reorderCategories(sourceId: Id, targetId: Id) {
    if (!data) return;
    const ordered = sortByOrder(data.categories);
    const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = withSortOrder(moveItem(ordered, sourceIndex, targetIndex));
    void persist({ ...data, categories: next }, makeEvent("修改", "分类顺序", ["拖拽排序"]), "分类顺序已保存");
  }

  function saveTags(tags: Tag[]) {
    if (!data) return;
    const validation = validateTags(tags);
    if (!validation.valid) {
      showToast("标签名称不能为空或重复", "error");
      return;
    }
    const normalizedTags = validation.normalized;
    const ids = new Set(normalizedTags.map((tag) => tag.id));
    const next = {
      ...data,
      tags: normalizedTags,
      services: data.services.map((service) => ({ ...service, tagIds: service.tagIds.filter((id) => ids.has(id)) })),
    };
    setSelectedTagIds((current) => new Set([...current].filter((id) => ids.has(id))));
    setEditor(null);
    const fields = describeTagCollectionChanges(data.tags, normalizedTags, data.services);
    void persist(next, fields.length ? makeEvent("修改", "标签", fields) : undefined, "标签已更新");
  }

  function requestSaveAccounts(accounts: AccountRecord[]) {
    if (!data) return;
    const originals = data.accounts.filter((item) => item.serviceId === selectedServiceId);
    const originalIndex = new Map(originals.map((item) => [item.id, item]));
    const changedIds = accounts
      .filter((account) => {
        const previous = originalIndex.get(account.id);
        return previous && previous.password !== account.password;
      })
      .map((account) => account.id);
    if (changedIds.length) {
      setPendingPasswordBatch({ originals, drafts: accounts, changedIds, currentIndex: 0 });
      return;
    }
    commitAccountSet(accounts, originals);
  }

  function commitPasswordUpdate(keepOld: boolean) {
    if (!pendingPasswordBatch) return;
    const { originals, drafts, changedIds, currentIndex } = pendingPasswordBatch;
    const id = changedIds[currentIndex];
    const previous = originals.find((item) => item.id === id);
    const next = drafts.find((item) => item.id === id);
    if (!previous || !next) return;
    const updatedDrafts = drafts.map((account) => account.id === id ? {
      ...account,
      passwordHistory: updatePasswordHistory(previous.password, account.password, previous.passwordHistory, keepOld, account.updatedAt),
    } : account);
    if (currentIndex + 1 < changedIds.length) {
      setPendingPasswordBatch({ ...pendingPasswordBatch, drafts: updatedDrafts, currentIndex: currentIndex + 1 });
      return;
    }
    setPendingPasswordBatch(null);
    commitAccountSet(updatedDrafts, originals);
  }

  function commitAccountSet(accounts: AccountRecord[], originals: AccountRecord[]) {
    if (!data || !selectedServiceId) return;
    const service = data.services.find((item) => item.id === selectedServiceId);
    if (!service) return;
    const originalIds = new Set(originals.map((item) => item.id));
    const nextIds = new Set(accounts.map((item) => item.id));
    const added = accounts.filter((item) => !originalIds.has(item.id)).length;
    const deleted = originals.filter((item) => !nextIds.has(item.id)).length;
    const orderedAccounts = withSortOrder(accounts);
    const nextData = {
      ...data,
      services: data.services.map((item) => item.id === service.id ? { ...item, updatedAt: nowIso() } : item),
      accounts: [...data.accounts.filter((item) => item.serviceId !== service.id), ...orderedAccounts],
    };
    setEditor(null);
    setSelectedAccountId(orderedAccounts.find((item) => item.id === selectedAccountId)?.id || orderedAccounts[0]?.id || null);
    const originalById = new Map(originals.map((account) => [account.id, account]));
    const nextById = new Map(orderedAccounts.map((account) => [account.id, account]));
    const events: AuditEvent[] = [];
    for (const account of orderedAccounts) {
      const previous = originalById.get(account.id);
      if (!previous) {
        const fields = ["新增账号", account.password ? "已设置密码" : "", account.images.length ? `新增图片 ${account.images.length} 张` : ""].filter(Boolean);
        events.push(makeEvent("新增", service.name, fields, account.label));
        continue;
      }
      const fields = describeAccountChanges(previous, account);
      if (fields.length) events.push(makeEvent("修改", service.name, fields, account.label));
    }
    for (const account of originals) {
      if (!nextById.has(account.id)) {
        const fields = ["删除账号", account.images.length ? `删除图片 ${account.images.length} 张` : ""].filter(Boolean);
        events.push(makeEvent("删除", service.name, fields, account.label));
      }
    }
    void persist(nextData, events, added || deleted ? "账号清单已更新" : "账号信息已更新");
  }

  async function saveSettings(settings: AppSettings) {
    if (!data) return false;
    const fields = [
      settings.passwordTemplate !== data.settings.passwordTemplate
        ? settings.passwordTemplate ? "默认密码模板已更新" : "默认密码模板已清除"
        : "",
      settings.encryptImages !== data.settings.encryptImages
        ? settings.encryptImages ? "本地图片加密已启用" : "本地图片加密已关闭"
        : "",
    ].filter(Boolean);
    if (!fields.length) return true;
    const onlyImageEncryptionChanged = settings.passwordTemplate === data.settings.passwordTemplate;
    return persist(
      { ...data, settings },
      makeEvent("修改", "设置", fields),
      onlyImageEncryptionChanged
        ? settings.encryptImages ? "图片文件已加密" : "图片文件已恢复为普通格式"
        : "设置已保存",
    );
  }

  function reorderServices(sourceId: Id, targetId: Id) {
    if (!data) return;
    const ordered = sortByOrder(data.services);
    const next = withSortOrder(moveItem(ordered, ordered.findIndex((item) => item.id === sourceId), ordered.findIndex((item) => item.id === targetId)));
    void persist({ ...data, services: next }, makeEvent("修改", "记录顺序", ["拖拽排序"]), "记录顺序已保存");
  }

  async function copyValue(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label}已复制`);
    } catch {
      showToast("复制失败，请手动选择内容", "error");
    }
  }

  function openUrl(url: string) {
    if (!validateExternalUrl(url)) {
      showToast("网址无效，仅支持 http 或 https", "error");
      return;
    }
    void openExternal(url).catch((error) => showToast(`打开网址失败：${String(error)}`, "error"));
  }

  async function createBackup() {
    if (!data) return;
    setExchangeBusy("backup");
    setExchangeError("");
    setExchangeResult("");
    try {
      const path = await exportBackup(data);
      await appendAudit(makeEvent("备份", "全部数据", ["加密完整备份"]));
      setExchangeResult(`加密备份已创建：${path}`);
      showToast(`备份已创建：${path}`);
    } catch (error) {
      setExchangeError(`备份失败：${String(error)}`);
      showToast(`备份失败：${String(error)}`, "error");
    } finally {
      setExchangeBusy(null);
    }
  }

  async function importBackup(file?: File) {
    if (!file || !data) return;
    setExchangeBusy("import");
    setExchangeError("");
    setExchangeResult("");
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        setPendingImport(await importExcel(await file.arrayBuffer(), file.name, file.lastModified));
        setImportError("");
        setEditor(null);
        return;
      }
      const text = await file.text();
      try {
        const info = await inspectBackup(text);
        if (info.startupLockEnabled) {
          setProtectedBackup({ text, fileName: file.name, createdAt: info.createdAt });
        } else {
          setPendingImport(prepareImportData(await decryptBackup(text), {
            fileName: file.name,
            sourceType: "encrypted",
            createdAt: info.createdAt,
          }));
        }
      } catch (encryptedError) {
        if (!file.name.toLowerCase().endsWith(".json")) throw encryptedError;
        setPendingImport(prepareImportData(JSON.parse(text), {
          fileName: file.name,
          sourceType: "json",
          createdAt: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
        }));
      }
      setImportError("");
      setEditor(null);
    } catch (error) {
      setExchangeError(`导入失败：${String(error)}`);
      showToast(`导入失败：${String(error)}`, "error");
    } finally {
      setExchangeBusy(null);
    }
  }

  async function createOfficeExport(kind: "excel" | "word") {
    if (!data) return;
    setExchangeBusy(kind);
    setExchangeError("");
    setExchangeResult("");
    try {
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const fileName = `account-notebook-${timestamp}.${kind === "excel" ? "xlsx" : "docx"}`;
      const bytes = kind === "excel" ? await exportExcel(data) : await exportWord(data);
      const path = await saveOfficeExport(fileName, bytes);
      const label = kind === "excel" ? "标准 Excel" : "只读 Word";
      await appendAudit(makeEvent("备份", "全部数据", [`导出${label}`]));
      setExchangeResult(`${label} 已导出：${path}`);
      showToast(`${label} 已导出`);
    } catch (error) {
      setExchangeError(`导出失败：${String(error)}`);
      showToast(`导出失败：${String(error)}`, "error");
    } finally {
      setExchangeBusy(null);
    }
  }

  async function unlockProtectedBackup(credential: string) {
    if (!protectedBackup) return;
    const prepared = prepareImportData(await decryptBackup(protectedBackup.text, credential), {
      fileName: protectedBackup.fileName,
      sourceType: "encrypted",
      createdAt: protectedBackup.createdAt,
    });
    setProtectedBackup(null);
    setPendingImport(prepared);
    setImportError("");
  }

  async function confirmImport() {
    if (!data || !pendingImport || importBusy) return;
    setImportBusy(true);
    setImportError("");
    let rollbackPath: string;
    try {
      rollbackPath = await replaceDataWithRollback(data, pendingImport.data, {
        createRollback: createRollbackBackup,
        save: saveAppData,
      });
    } catch (error) {
      const failure = error instanceof SafeImportError ? error : new SafeImportError("save", String(error));
      setImportError(failure.stage === "backup"
        ? `未能创建回滚备份，导入已取消。当前数据没有改变。${failure.message}`
        : `导入写入失败，当前数据没有改变。回滚备份：${failure.rollbackPath}。${failure.message}`);
      setImportBusy(false);
      return;
    }

    const completed = pendingImport;
    setSelectedCategoryId("all");
    setSelectedTagIds(new Set());
    applyLoadedData(completed.data);
    setPendingImport(null);
    setImportResult({ rollbackPath, counts: completed.counts });
    setImportBusy(false);
    try {
      await appendAudit(makeEvent("导入", "全部数据", [`${completed.counts.services} 个分区`, `${completed.counts.accounts} 个账号`, `回滚备份 ${rollbackPath}`]));
      showToast("备份已安全导入");
    } catch (error) {
      showToast(`数据已导入，但日志写入失败：${String(error)}`, "neutral");
    }
  }

  async function openLogs() {
    try {
      setLogs(await readAuditLogs());
      setEditor({ type: "logs" });
    } catch (error) {
      showToast(`日志读取失败：${String(error)}`, "error");
    }
  }

  async function refreshSecurity() {
    const status = await getSecurityStatus();
    setSecurity(status);
    return status;
  }

  async function recordSecurityChange(fields: string[]) {
    try {
      await appendAudit(makeEvent("修改", "安全设置", fields));
    } catch (error) {
      showToast(`安全设置已更新，但日志写入失败：${String(error)}`, "neutral");
    }
  }

  async function refreshSecurityAfterChange() {
    try {
      await refreshSecurity();
    } catch (error) {
      showToast(`安全设置已更新，但状态刷新失败：${String(error)}`, "neutral");
    }
  }

  async function handleEnableStartupLock(password: string) {
    const result = await enableStartupLock(password);
    await refreshSecurityAfterChange();
    await recordSecurityChange(["启动密码已启用", "恢复码已生成"]);
    return result.recoveryCode;
  }

  async function handleRegenerateRecoveryCode() {
    const result = await regenerateRecoveryCode();
    await refreshSecurityAfterChange();
    await recordSecurityChange(["恢复码已重新生成", "旧恢复码已废止"]);
    showToast("新恢复码已生成");
    return result.recoveryCode;
  }

  async function handleChangeStartupPassword(password: string) {
    await changeStartupPassword(password);
    await refreshSecurityAfterChange();
    await recordSecurityChange(["启动密码已更新"]);
    showToast("启动密码已更新");
  }

  async function handleDisableStartupLock() {
    await disableStartupLock();
    await refreshSecurityAfterChange();
    await recordSecurityChange(["启动密码已关闭", "恢复码已废止"]);
    showToast("启动密码已关闭");
  }

  if (bootError) {
    return <div className="loading-screen loading-screen--error"><BookKey size={28} /><strong>无法打开数据</strong><span>{bootError}</span></div>;
  }
  if (!security) {
    return <div className="loading-screen"><BookKey size={28} /><span>正在检查本地数据…</span></div>;
  }
  if (!security.unlocked) {
    return <LockScreen busy={unlockBusy} error={unlockError} onUnlock={(credential) => void handleUnlock(credential)} />;
  }
  if (!data) {
    return <div className="loading-screen"><BookKey size={28} /><span>正在解密本地记录…</span></div>;
  }

  const selectedService = data.services.find((service) => service.id === selectedServiceId) || null;
  const selectedAccounts = sortByOrder(data.accounts.filter((account) => account.serviceId === selectedService?.id));
  const editingCategory = editor?.type === "category" ? editor.category : null;
  const editingParentId = editor?.type === "category" ? editor.parentId : null;
  const parentName = data.categories.find((category) => category.id === editingParentId)?.name;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span><img src="/favicon.png" alt="" /></span><div><strong>我密码呢</strong><small>本地账号信息记事本</small></div></div>
        <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索软件、账号、备注或标签" />{search ? <button onClick={() => setSearch("")} title="清空搜索"><X size={15} /></button> : null}</label>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => { setExchangeError(""); setExchangeResult(""); setEditor({ type: "exchange" }); }} title="数据交换"><ArrowLeftRight size={18} /></button>
          <button className="icon-button" onClick={() => void openLogs()} title="查看修改日志"><FileClock size={18} /></button>
          <button className="icon-button" onClick={() => void revealDataDirectory().then((message) => showToast(message, "neutral"))} title="打开数据目录"><Database size={18} /></button>
          <button className="icon-button" onClick={() => setEditor({ type: "settings" })} title="设置"><SettingsIcon size={18} /></button>
        </div>
      </header>

      <div className="workspace">
        <Sidebar
          categories={data.categories}
          tags={data.tags}
          services={data.services}
          selectedCategoryId={selectedCategoryId}
          selectedTagIds={selectedTagIds}
          onCategoryChange={setSelectedCategoryId}
          onTagToggle={(id) => setSelectedTagIds((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })}
          onCreateCategory={(parentId) => setEditor({ type: "category", category: null, parentId })}
          onRenameCategory={(category) => setEditor({ type: "category", category, parentId: category.parentId })}
          onDeleteCategory={deleteCategory}
          onReorderCategory={reorderCategories}
          onManageTags={() => setEditor({ type: "tags" })}
        />
        <ServiceList services={filteredServices} accounts={data.accounts} categories={data.categories} tags={data.tags} searchMatches={searchView.matches} searchActive={Boolean(deferredSearch.trim())} selectedServiceId={selectedServiceId} onSelect={selectService} onAdd={() => setEditor({ type: "service", service: null })} onReorder={reorderServices} />
        {selectedService ? (
          <AccountDetail
            key={`${selectedService.id}:${selectedAccountId || "none"}`}
            service={selectedService}
            accounts={selectedAccounts}
            tags={data.tags}
            selectedAccountId={selectedAccountId}
            onSelectAccount={setSelectedAccountId}
            onAddAccount={() => setEditor({ type: "accounts" })}
            onEditAccount={() => setEditor({ type: "accounts" })}
            onEditService={() => setEditor({ type: "service", service: selectedService })}
            onOpenUrl={openUrl}
            onCopy={(value, label) => void copyValue(value, label)}
            onPreviewImage={(url, name) => setImagePreview({ url, name })}
          />
        ) : (
          <main className="empty-workspace"><BookKey size={32} /><strong>{filteredServices.length === 0 && data.services.length > 0 ? "没有匹配的记录" : "开始建立账号记录"}</strong><span>{data.services.length > 0 ? "调整筛选条件，或新建一个分区" : "先建立一个软件或网站分区"}</span><button className="button button--primary" onClick={() => setEditor({ type: "service", service: null })}>新建分区</button></main>
        )}
      </div>

      {editor?.type === "service" ? <ServiceEditor service={editor.service} categories={data.categories} tags={data.tags} onClose={() => setEditor(null)} onSave={saveService} onDelete={editor.service ? () => deleteService(editor.service!) : undefined} /> : null}
      {editor?.type === "accounts" && selectedService ? <AccountManager key={selectedService.id} accounts={selectedAccounts} serviceId={selectedService.id} serviceName={selectedService.name} passwordTemplate={data.settings.passwordTemplate} initialAccountId={selectedAccountId} onClose={() => setEditor(null)} onSave={requestSaveAccounts} /> : null}
      {editor?.type === "category" ? <CategoryEditor category={editingCategory} parentId={editingParentId} parentName={parentName} onClose={() => setEditor(null)} onSave={saveCategory} /> : null}
      {editor?.type === "tags" ? <TagManager initialTags={data.tags} usageCounts={countTagUsage(data.services)} onClose={() => setEditor(null)} onSave={saveTags} /> : null}
      {editor?.type === "settings" ? <SettingsDialog status={security} passwordTemplate={data.settings.passwordTemplate} encryptImages={data.settings.encryptImages} onClose={() => setEditor(null)} onEnable={handleEnableStartupLock} onChange={handleChangeStartupPassword} onRegenerate={handleRegenerateRecoveryCode} onDisable={handleDisableStartupLock} onLock={async () => { await lockVault(); setData(null); setEditor(null); await refreshSecurity(); }} onLoadStats={getStorageStats} onSaveSettings={saveSettings} /> : null}
      {editor?.type === "exchange" ? <DataExchangeDialog busyAction={exchangeBusy} result={exchangeResult} error={exchangeError} onClose={() => setEditor(null)} onBackup={() => void createBackup()} onImport={(file) => void importBackup(file)} onExportExcel={() => void createOfficeExport("excel")} onExportWord={() => void createOfficeExport("word")} /> : null}
      {editor?.type === "logs" ? <LogsDialog logs={logs} onClose={() => setEditor(null)} onOpenFile={() => void openAuditLog().then((message) => showToast(message, "neutral"))} /> : null}
      {protectedBackup ? <BackupCredentialDialog onClose={() => setProtectedBackup(null)} onSubmit={unlockProtectedBackup} /> : null}
      {pendingImport ? <ImportPreviewDialog preview={pendingImport} busy={importBusy} error={importError} onClose={() => { if (!importBusy) { setPendingImport(null); setImportError(""); } }} onConfirm={() => void confirmImport()} /> : null}
      {importResult ? <ImportResultDialog rollbackPath={importResult.rollbackPath} counts={importResult.counts} onClose={() => setImportResult(null)} onOpenDirectory={() => void revealDataDirectory().then((message) => showToast(message, "neutral"))} /> : null}
      {pendingPasswordBatch ? (() => { const id = pendingPasswordBatch.changedIds[pendingPasswordBatch.currentIndex]; const previous = pendingPasswordBatch.originals.find((item) => item.id === id)!; const next = pendingPasswordBatch.drafts.find((item) => item.id === id)!; return <PasswordDecision accountLabel={next.label} oldPassword={previous.password} newPassword={next.password} onCancel={() => setPendingPasswordBatch(null)} onConfirm={commitPasswordUpdate} />; })() : null}
      {imagePreview ? <ImagePreview {...imagePreview} onClose={() => setImagePreview(null)} /> : null}

      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <button key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>{toast.message}</button>)}</div>
    </div>
  );
}
