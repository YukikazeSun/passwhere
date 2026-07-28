import { describe, expect, it } from "vitest";
import {
  applyPasswordTemplate,
  inspectPasswordTemplate,
  isPasswordTemplateConfigured,
  validatePasswordTemplate,
  WEBSITE_NAME_PLACEHOLDER,
} from "./passwordTemplate";

describe("password templates", () => {
  it("requires the website name placeholder for configured templates", () => {
    expect(validatePasswordTemplate("")).toBeNull();
    expect(validatePasswordTemplate("Fixed!2026")).toContain(WEBSITE_NAME_PLACEHOLDER);
    expect(isPasswordTemplateConfigured(`Fixed!2026${WEBSITE_NAME_PLACEHOLDER}`)).toBe(true);
  });

  it("replaces every website name placeholder", () => {
    expect(applyPasswordTemplate(`A${WEBSITE_NAME_PLACEHOLDER}!${WEBSITE_NAME_PLACEHOLDER}`, "Steam"))
      .toBe("ASteam!Steam");
  });

  it("reports the fixed structure without counting placeholder characters", () => {
    expect(inspectPasswordTemplate(`Fixed!2026${WEBSITE_NAME_PLACEHOLDER}`)).toEqual({
      uppercase: true,
      lowercase: true,
      number: true,
      special: true,
      placeholder: true,
    });
  });
});
