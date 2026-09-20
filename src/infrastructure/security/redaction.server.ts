import "server-only";

const sensitiveAssignment = /((?:["']?(?:api[_-]?key|authorization|token|password|secret|cookie|set-cookie|x-api-key|access[_-]?token|refresh[_-]?token)["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi;
const bearerCredential = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const sensitiveQuery = /([?&](?:api[_-]?key|token|access[_-]?token|password|secret)=)[^&#\s]+/gi;

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "[无法安全显示的值]";
  }
}

/** Produces a bounded diagnostic suitable for browser events and server logs. */
export function redactForDisplay(value: unknown, limit = 2400): string {
  const safe = stringify(value)
    .replace(sensitiveAssignment, "$1[已隐藏]")
    .replace(bearerCredential, "Bearer [已隐藏]")
    .replace(sensitiveQuery, "$1[已隐藏]");
  return safe.length > limit ? `${safe.slice(0, limit)}\n…已截断` : safe;
}
