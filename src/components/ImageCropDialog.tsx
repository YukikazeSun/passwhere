import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Crop, LoaderCircle, RotateCcw } from "lucide-react";
import type { StoredImage } from "../types";
import { Modal } from "./Modal";

interface ImageCropDialogProps {
  image: StoredImage;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  x: number;
  y: number;
}

interface DragState {
  mode: "draw" | "move";
  startX: number;
  startY: number;
  origin: Rect;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

export function fitCropToRatio(rect: Rect, size: Size, ratio: number | null) {
  let width = Math.max(2, rect.width);
  let height = Math.max(2, rect.height);
  if (ratio) {
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
    const maxWidth = Math.min(size.width, size.height * ratio);
    const maxHeight = Math.min(size.height, size.width / ratio);
    if (width > maxWidth) {
      width = maxWidth;
      height = width / ratio;
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
  } else {
    width = Math.min(width, size.width);
    height = Math.min(height, size.height);
  }
  return {
    x: clamp(rect.x, 0, size.width - width),
    y: clamp(rect.y, 0, size.height - height),
    width,
    height,
  };
}

export default function ImageCropDialog({ image, onCancel, onConfirm }: ImageCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const [sourceSize, setSourceSize] = useState<Size | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ratioKey, setRatioKey] = useState("source");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const sourceUrl = image.dataUrl || image.sourceUrl || "";
  const ratio = useMemo(() => {
    if (ratioKey === "free") return null;
    if (ratioKey === "square") return 1;
    if (ratioKey === "landscape") return 4 / 3;
    if (ratioKey === "wide") return 16 / 9;
    return sourceSize ? sourceSize.width / sourceSize.height : null;
  }, [ratioKey, sourceSize]);

  useEffect(() => {
    const source = new Image();
    source.onload = () => {
      sourceImageRef.current = source;
      const size = { width: source.naturalWidth, height: source.naturalHeight };
      setSourceSize(size);
      const inset = Math.max(0, Math.min(size.width, size.height) * 0.04);
      setCrop(fitCropToRatio({ x: inset, y: inset, width: size.width - inset * 2, height: size.height - inset * 2 }, size, size.width / size.height));
    };
    source.onerror = () => setLoadError("图片无法载入，无法进行裁切");
    source.src = sourceUrl;
    return () => {
      source.onload = null;
      source.onerror = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceImageRef.current;
    if (!canvas || !source || !sourceSize || !crop) return;
    const scale = Math.min(760 / sourceSize.width, 420 / sourceSize.height, 1);
    canvas.width = Math.max(1, Math.round(sourceSize.width * scale));
    canvas.height = Math.max(1, Math.round(sourceSize.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const displayCrop = { x: crop.x * scale, y: crop.y * scale, width: crop.width * scale, height: crop.height * scale };
    context.fillStyle = "rgba(15, 23, 42, 0.56)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.rect(displayCrop.x, displayCrop.y, displayCrop.width, displayCrop.height);
    context.clip();
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    context.restore();
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(1, 2 * scale);
    context.strokeRect(displayCrop.x, displayCrop.y, displayCrop.width, displayCrop.height);
  }, [crop, sourceSize]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceSize) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) * sourceSize.width / bounds.width, 0, sourceSize.width),
      y: clamp((event.clientY - bounds.top) * sourceSize.height / bounds.height, 0, sourceSize.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!crop || !sourceSize) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const inside = point.x >= crop.x && point.x <= crop.x + crop.width && point.y >= crop.y && point.y <= crop.y + crop.height;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ mode: inside ? "move" : "draw", startX: point.x, startY: point.y, origin: crop });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag || !sourceSize) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (drag.mode === "move") {
      setCrop(fitCropToRatio({ ...drag.origin, x: drag.origin.x + point.x - drag.startX, y: drag.origin.y + point.y - drag.startY }, sourceSize, ratio));
      return;
    }
    const x = Math.min(drag.startX, point.x);
    const y = Math.min(drag.startY, point.y);
    setCrop(fitCropToRatio({ x, y, width: Math.abs(point.x - drag.startX), height: Math.abs(point.y - drag.startY) }, sourceSize, ratio));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const resetCrop = () => {
    if (!sourceSize) return;
    const inset = Math.max(0, Math.min(sourceSize.width, sourceSize.height) * 0.04);
    setRatioKey("source");
    setCrop(fitCropToRatio({ x: inset, y: inset, width: sourceSize.width - inset * 2, height: sourceSize.height - inset * 2 }, sourceSize, sourceSize.width / sourceSize.height));
  };

  const confirmCrop = () => {
    const source = sourceImageRef.current;
    if (!source || !sourceSize || !crop) return;
    setSaving(true);
    const output = document.createElement("canvas");
    const scale = Math.min(1, 2000 / crop.width, 2000 / crop.height);
    output.width = Math.max(1, Math.round(crop.width * scale));
    output.height = Math.max(1, Math.round(crop.height * scale));
    const context = output.getContext("2d");
    if (!context) {
      setSaving(false);
      return;
    }
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
    const mime = /^data:([^;,]+)/.exec(sourceUrl)?.[1] || "image/png";
    onConfirm(output.toDataURL(mime === "image/x-icon" ? "image/png" : mime));
  };

  return <Modal title="裁切图片" subtitle="拖动白框选择区域，输出会保持比例且不会拉伸图片" onClose={onCancel} width="large" closeDisabled={saving}>
    <div className="image-crop-dialog">
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
      {sourceSize && crop ? <>
        <div className="image-crop-toolbar" role="toolbar" aria-label="裁切比例">
          <span>裁切比例</span>
          {[["source", "原图比例"], ["square", "1:1"], ["landscape", "4:3"], ["wide", "16:9"], ["free", "自由"]].map(([key, label]) => <button key={key} type="button" className={ratioKey === key ? "is-active" : ""} onClick={() => { setRatioKey(key); setCrop((current) => current ? fitCropToRatio(current, sourceSize, key === "free" ? null : key === "square" ? 1 : key === "landscape" ? 4 / 3 : key === "wide" ? 16 / 9 : sourceSize.width / sourceSize.height) : current); }}>{label}</button>)}
          <button type="button" className="icon-button icon-button--small" onClick={resetCrop} title="重置裁切"><RotateCcw size={15} /></button>
        </div>
        <div className="image-crop-stage"><canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} aria-label="图片裁切区域" /></div>
        <p className="image-crop-meta">原图 {sourceSize.width} × {sourceSize.height} · 输出 {Math.round(crop.width)} × {Math.round(crop.height)}</p>
      </> : !loadError ? <div className="image-crop-loading"><LoaderCircle className="spin" size={20} />正在载入图片…</div> : null}
    </div>
    <footer className="modal-footer"><span><Crop size={15} /> {image.name}</span><div><button type="button" className="button button--quiet" onClick={onCancel} disabled={saving}>取消</button><button type="button" className="button button--primary" onClick={confirmCrop} disabled={!sourceSize || !crop || saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} 应用裁切</button></div></footer>
  </Modal>;
}
