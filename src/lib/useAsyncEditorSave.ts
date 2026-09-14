import { useCallback, useRef, useState } from "react";

export type EditorSaveResult = "saved" | "cancelled" | "failed";
export type EditorSaveAttempt = EditorSaveResult | "blocked";

export async function runWithSaveGate(
  gate: { current: boolean },
  save: () => Promise<EditorSaveResult>,
): Promise<EditorSaveAttempt> {
  if (gate.current) return "blocked";
  gate.current = true;
  try {
    return await save();
  } finally {
    gate.current = false;
  }
}

export function useAsyncEditorSave(onClose: () => void) {
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const runSave = useCallback(async (save: () => Promise<EditorSaveResult>) => {
    if (savingRef.current) return;
    setSaving(true);
    setSaveError("");
    let editorClosed = false;
    try {
      const result = await runWithSaveGate(savingRef, save);
      if (result === "saved") {
        editorClosed = true;
        onClose();
      } else if (result === "failed") {
        setSaveError("保存失败，当前草稿仍保留，请重试。请查看右下角提示了解原因。");
      }
    } catch (error) {
      setSaveError(`保存失败，当前草稿仍保留：${String(error)}`);
    } finally {
      if (!editorClosed) setSaving(false);
    }
  }, [onClose]);

  return { saving, saveError, runSave };
}
