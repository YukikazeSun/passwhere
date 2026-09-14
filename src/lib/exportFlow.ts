export type ExportWithAuditResult<T> = {
  result: T;
  auditError?: unknown;
};

/**
 * Completes a file export without allowing a secondary audit failure to
 * disguise a successful file write. The primary write error still rejects.
 */
export async function exportWithAudit<T>(
  write: () => Promise<T>,
  audit: () => Promise<void>,
): Promise<ExportWithAuditResult<T>> {
  const result = await write();
  try {
    await audit();
    return { result };
  } catch (auditError) {
    return { result, auditError };
  }
}
