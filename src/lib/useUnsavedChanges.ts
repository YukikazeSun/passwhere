import { useCallback, useEffect, useState } from "react";

export function useUnsavedChanges(isDirty: boolean, onClose: () => void) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeWindowClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeWindowClose);
    return () => window.removeEventListener("beforeunload", warnBeforeWindowClose);
  }, [isDirty]);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmationOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const discardAndClose = useCallback(() => {
    setConfirmationOpen(false);
    onClose();
  }, [onClose]);

  return {
    confirmationOpen,
    requestClose,
    discardAndClose,
    continueEditing: () => setConfirmationOpen(false),
  };
}
