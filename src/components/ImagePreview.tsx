import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";

export function ImagePreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    closeButtonRef.current?.focus();
  };

  return (
    <div className="image-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={previewRef} onKeyDown={handleKeyDown} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button ref={closeButtonRef} type="button" className="icon-button" onClick={onClose} title="关闭" aria-label="关闭图片预览"><X size={20} /></button>
      <img src={url} alt={name} onClick={(event) => event.stopPropagation()} />
      <span id={titleId}>{name}</span>
    </div>
  );
}
