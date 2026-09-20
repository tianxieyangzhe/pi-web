export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
    readonly recoverable = false,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requiredText(
  value: unknown,
  field: string,
  label: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError(
      "INVALID_INPUT",
      `${label}不能为空`,
      400,
      true,
      { [field]: [`${label}不能为空`] },
    );
  }
  return value.trim();
}

export function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function uniqueStrings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DomainError("INVALID_INPUT", `${field}必须是字符串数组`, 400, true);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  fallback?: T[number],
): T[number] {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field}必须是 ${allowed.join("、")} 之一`,
      400,
      true,
      { [field]: ["值不在允许范围内"] },
    );
  }
  return value as T[number];
}
