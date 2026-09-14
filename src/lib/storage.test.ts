import { describe, expect, it } from "vitest";
import { MAX_IMAGE_FILE_BYTES, validateImageFile } from "./storage";

describe("validateImageFile", () => {
  it("accepts supported image signatures including ico files without a MIME type", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "code.png", { type: "image/png" });
    const ico = new File([new Uint8Array([0x00, 0x00, 0x01, 0x00])], "account.ico");

    await expect(validateImageFile(png)).resolves.toBe("image/png");
    await expect(validateImageFile(ico)).resolves.toBe("image/x-icon");
  });

  it("uses the file signature when clipboard metadata has the wrong MIME type", async () => {
    const pngNamedJpeg = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "clipboard.jpg", { type: "image/jpeg" });
    await expect(validateImageFile(pngNamedJpeg)).resolves.toBe("image/png");
  });

  it("rejects a file whose contents do not match its image format", async () => {
    const disguised = new File(["not a png"], "fake.png", { type: "image/png" });
    await expect(validateImageFile(disguised)).rejects.toThrow("内容与格式不匹配");
  });

  it("rejects oversized images before reading their contents", async () => {
    const oversized = {
      name: "large.png",
      type: "image/png",
      size: MAX_IMAGE_FILE_BYTES + 1,
      slice: () => { throw new Error("should not read oversized file"); },
    } as unknown as File;

    await expect(validateImageFile(oversized)).rejects.toThrow("超过 15 MB 限制");
  });
});
