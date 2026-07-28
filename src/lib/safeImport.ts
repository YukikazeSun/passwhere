import type { AppData } from "../types";

export class SafeImportError extends Error {
  constructor(
    public readonly stage: "backup" | "save",
    message: string,
    public readonly rollbackPath = "",
  ) {
    super(message);
    this.name = "SafeImportError";
  }
}

export async function replaceDataWithRollback(
  currentData: AppData,
  importedData: AppData,
  operations: {
    createRollback: (data: AppData) => Promise<string>;
    save: (data: AppData) => Promise<unknown>;
  },
) {
  let rollbackPath: string;
  try {
    rollbackPath = await operations.createRollback(currentData);
  } catch (error) {
    throw new SafeImportError("backup", String(error));
  }

  try {
    await operations.save(importedData);
  } catch (error) {
    throw new SafeImportError("save", String(error), rollbackPath);
  }
  return rollbackPath;
}
