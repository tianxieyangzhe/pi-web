import { DomainError } from "@/domain/errors";

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T>(value: unknown, field: string): T {
  if (typeof value !== "string") {
    throw new DomainError("CORRUPT_DATA", `${field}不是有效 JSON`, 500);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new DomainError("CORRUPT_DATA", `${field}不是有效 JSON`, 500);
  }
}
