import { describe, expect, it } from "vitest";
import { fitCropToRatio } from "./ImageCropDialog";

describe("fitCropToRatio", () => {
  it("keeps a square crop square when the source is very wide", () => {
    const crop = fitCropToRatio({ x: 0, y: 0, width: 287, height: 71 }, { width: 293, height: 72 }, 1);
    expect(crop.width).toBe(72);
    expect(crop.height).toBe(72);
  });

  it("keeps a requested landscape ratio within a tall source", () => {
    const crop = fitCropToRatio({ x: 0, y: 0, width: 120, height: 300 }, { width: 120, height: 300 }, 4 / 3);
    expect(crop.width / crop.height).toBeCloseTo(4 / 3, 5);
    expect(crop.width).toBeLessThanOrEqual(120);
    expect(crop.height).toBeLessThanOrEqual(300);
  });
});
