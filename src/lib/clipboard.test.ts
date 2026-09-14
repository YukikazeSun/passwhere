import { describe, expect, it, vi } from "vitest";
import { writeClipboardText, type ClipboardWriter } from "./clipboard";

describe("clipboard helper", () => {
  it("writes the requested value", async () => {
    const clipboard: ClipboardWriter = { writeText: vi.fn().mockResolvedValue(undefined) };
    await writeClipboardText("recovery-code", clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith("recovery-code");
  });

  it("propagates clipboard failures so the UI can provide feedback", async () => {
    const failure = new Error("denied");
    const clipboard: ClipboardWriter = { writeText: vi.fn().mockRejectedValue(failure) };
    await expect(writeClipboardText("recovery-code", clipboard)).rejects.toBe(failure);
  });

  it("rejects when the host does not expose a clipboard writer", async () => {
    await expect(writeClipboardText("recovery-code", undefined)).rejects.toThrow("Clipboard is unavailable");
  });
});
