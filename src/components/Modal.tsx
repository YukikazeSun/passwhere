import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, LoaderCircle, X } from "lucide-react";

export function Modal({ title, subtitle, onClose, children, width = "medium", closeDisabled = false }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: "small" | "medium" | "large" | "wide";
  closeDisabled?: boolean;
}) {
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    if (modal && !modal.contains(document.activeElement)) {
      const preferredTarget = modal.querySelector<HTMLElement>("[autofocus]");
      (preferredTarget || modal).focus();
    }
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (!closeDisabled) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      return;
    }
    if (event.key !== "Tab") return;

    const modal = modalRef.current;
    if (!modal) return;
    const focusable = [...modal.querySelectorAll<HTMLElement>(
      'a[href]:not([hidden]), button:not([disabled]):not([hidden]), input:not([disabled]):not([type="hidden"]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])',
    )];
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const activeIsFocusable = active instanceof HTMLElement && focusable.includes(active);
    if (event.shiftKey && (active === first || !activeIsFocusable)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !activeIsFocusable)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose(); }}>
      <section ref={modalRef} className={`modal modal--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="modal-header">
          <div><h2 id={titleId}>{title}</h2>{subtitle ? <p id={subtitleId}>{subtitle}</p> : null}</div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭" disabled={closeDisabled}><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function UnsavedChangesDialog({ canSave, saving = false, saveError = "", onSave, onDiscard, onContinue }: {
  canSave: boolean;
  saving?: boolean;
  saveError?: string;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal title="有未保存的修改" subtitle="关闭前请选择如何处理当前内容" onClose={onContinue} width="small" closeDisabled={saving}>
      <div className="modal-body confirm-dialog"><p>当前编辑内容尚未保存。直接放弃后无法恢复。</p>{saveError ? <p className="form-error" role="alert">{saveError}</p> : null}</div>
      <footer className="modal-footer modal-footer--three-actions">
        <button className="button button--quiet" onClick={onContinue} disabled={saving}>继续编辑</button>
        <button className="button button--danger" onClick={onDiscard} disabled={saving}>放弃修改</button>
        <button className="button button--primary" disabled={!canSave || saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} {saving ? "保存中" : "保存修改"}</button>
      </footer>
    </Modal>
  );
}
