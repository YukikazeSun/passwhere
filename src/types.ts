export type Id = string;

export interface RecordVersion {
  revision: number;
  updatedAt: string;
  modifiedByDeviceId: string;
}

export interface Category extends RecordVersion {
  id: Id;
  name: string;
  parentId: Id | null;
  color: string;
  sortOrder: number;
}

export interface Tag extends RecordVersion {
  id: Id;
  name: string;
  color: string;
}

export interface StoredImage {
  id: Id;
  name: string;
  dataUrl: string;
  sourceUrl?: string;
  storedPath?: string;
}

export interface ServiceRecord extends RecordVersion {
  id: Id;
  name: string;
  url: string;
  categoryId: Id | null;
  tagIds: Id[];
  icon: StoredImage | null;
  createdAt: string;
  sortOrder: number;
}

export interface SecurityQuestion {
  id: Id;
  question: string;
  answer: string;
}

export interface CustomField {
  id: Id;
  label: string;
  value: string;
  multiline: boolean;
  copyable: boolean;
}

export interface PasswordHistoryItem {
  id: Id;
  password: string;
  changedAt: string;
}

export type AccountDisplayModule =
  | "username"
  | "password"
  | "identity"
  | "securityPhone"
  | "securityEmail"
  | "security"
  | "custom"
  | "notes"
  | "images";

export interface AccountNote {
  id: Id;
  title: string;
  content: string;
}

export interface AccountRecord extends RecordVersion {
  id: Id;
  serviceId: Id;
  label: string;
  username: string;
  password: string;
  identityCode: string;
  /** Added after the initial data format; normalizers fill missing values. */
  securityPhone?: string;
  securityEmail?: string;
  notes: AccountNote[];
  visibleModules: AccountDisplayModule[];
  sortOrder: number;
  securityQuestions: SecurityQuestion[];
  customFields: CustomField[];
  images: StoredImage[];
  passwordHistory: PasswordHistoryItem[];
  createdAt: string;
}

export interface AppSettings {
  passwordTemplate: string;
  encryptImages: boolean;
}

export type SyncEntityType = "category" | "tag" | "service" | "account";

export interface DeletionTombstone {
  entityType: SyncEntityType;
  entityId: Id;
  revision: number;
  deletedAt: string;
  modifiedByDeviceId: string;
}

export interface AppSyncMetadata {
  vaultId: string;
  revision: number;
  settingsRevision: number;
  settingsUpdatedAt: string;
  settingsModifiedByDeviceId: string;
  tombstones: DeletionTombstone[];
}

interface RecycleBinItemBase {
  id: Id;
  deletedAt: string;
  type: SyncEntityType;
  label: string;
}

export interface RecycledCategoryItem extends RecycleBinItemBase {
  type: "category";
  category: Category;
  childCategoryIds: Id[];
  serviceIds: Id[];
}

export interface RecycledTagItem extends RecycleBinItemBase {
  type: "tag";
  tag: Tag;
  serviceIds: Id[];
}

export interface RecycledServiceItem extends RecycleBinItemBase {
  type: "service";
  service: ServiceRecord;
  accounts: AccountRecord[];
}

export interface RecycledAccountItem extends RecycleBinItemBase {
  type: "account";
  serviceName: string;
  account: AccountRecord;
}

export type RecycleBinItem =
  | RecycledCategoryItem
  | RecycledTagItem
  | RecycledServiceItem
  | RecycledAccountItem;

export interface AppData {
  version: number;
  settings: AppSettings;
  sync: AppSyncMetadata;
  categories: Category[];
  tags: Tag[];
  services: ServiceRecord[];
  accounts: AccountRecord[];
  recycleBin: RecycleBinItem[];
}

export interface AuditEvent {
  id: Id;
  timestamp: string;
  serviceName: string;
  accountLabel?: string;
  action: "新增" | "修改" | "删除" | "导入" | "备份";
  fields: string[];
}

export interface SaveResult {
  dataDir: string;
  updatedAt: string;
  data: AppData;
  warnings: string[];
}

export interface SecurityStatus {
  startupLockEnabled: boolean;
  unlocked: boolean;
  requiresPasswordChange: boolean;
}

export interface StorageStats {
  lastBackupAt: string | null;
  dataSizeBytes: number;
  imageSizeBytes: number;
  backupCount: number;
}

export interface UnlockResult {
  unlockedViaRecovery: boolean;
}

export interface BackupInfo {
  startupLockEnabled: boolean;
  createdAt: string;
  requiresCredential: boolean;
}

export interface ImportCounts {
  categories: number;
  tags: number;
  services: number;
  accounts: number;
  images: number;
}

export interface PreparedImport {
  fileName: string;
  sourceType: "encrypted" | "json" | "excel";
  sourceVersion: number;
  createdAt: string;
  data: AppData;
  counts: ImportCounts;
}
