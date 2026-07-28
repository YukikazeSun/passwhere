export const WEBSITE_NAME_PLACEHOLDER = "{网站名称}";

export interface PasswordTemplateStructure {
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
  placeholder: boolean;
}

export function inspectPasswordTemplate(template: string): PasswordTemplateStructure {
  const fixedText = template.split(WEBSITE_NAME_PLACEHOLDER).join("");
  return {
    uppercase: /[A-Z]/.test(fixedText),
    lowercase: /[a-z]/.test(fixedText),
    number: /[0-9]/.test(fixedText),
    special: /[^A-Za-z0-9\s]/.test(fixedText),
    placeholder: template.includes(WEBSITE_NAME_PLACEHOLDER),
  };
}

export function validatePasswordTemplate(template: string): string | null {
  if (!template) return null;
  if (!template.includes(WEBSITE_NAME_PLACEHOLDER)) {
    return `模板必须包含 ${WEBSITE_NAME_PLACEHOLDER}`;
  }
  if (template.length > 256) return "模板不能超过 256 个字符";
  return null;
}

export function applyPasswordTemplate(template: string, websiteName: string): string {
  return template.split(WEBSITE_NAME_PLACEHOLDER).join(websiteName);
}

export function isPasswordTemplateConfigured(template: string): boolean {
  return Boolean(template) && validatePasswordTemplate(template) === null;
}
