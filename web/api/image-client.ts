import { randomUUID } from "./random-uuid";
export type ImageRecord = Record<string, any>;
export async function imageRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    revision?: number;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<any> {
  const headers: Record<string, string> = {};
  if (options.method && options.method !== "GET")
    headers["Idempotency-Key"] = options.key ?? randomUUID();
  if (options.revision !== undefined)
    headers["If-Match"] = String(options.revision);
  const multipart = options.body instanceof FormData;
  if (options.body !== undefined && !multipart)
    headers["Content-Type"] = "application/json";
  const response = await fetch("/api/images" + path, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined
        ? undefined
        : multipart
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    signal: options.signal,
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.error?.message ?? "图片工作台请求失败"),
      { code: value.error?.code, commandId: value.error?.commandId },
    );
  return value.data;
}
