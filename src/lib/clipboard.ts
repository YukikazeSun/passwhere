export interface ClipboardWriter {
  writeText: (value: string) => Promise<void>;
}

export async function writeClipboardText(
  value: string,
  clipboard: ClipboardWriter | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
) {
  if (!clipboard?.writeText) throw new Error("Clipboard is unavailable");
  await clipboard.writeText(value);
}
