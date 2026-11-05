import { DomainError, isDomainError } from "@/domain/errors";

export type ApiError = {
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    fieldErrors?: Record<string, string[]>;
    operationId?: string;
  };
};

export function dataResponse<T>(data: T, init?: ResponseInit): Response {
  const headers=new Headers(init?.headers);if(!headers.has('cache-control'))headers.set('cache-control','no-store');
  return Response.json({ data }, {...init,headers});
}

export function errorResponse(error: unknown): Response {
  if (isDomainError(error)) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
          ...("operationId" in error && typeof error.operationId === "string" ? {operationId:error.operationId} : {}),
        },
      } satisfies ApiError,
      { status: error.status,headers:{'cache-control':'no-store'} },
    );
  }

  console.error(error);
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用",
        recoverable: true,
      },
    } satisfies ApiError,
    { status: 500,headers:{'cache-control':'no-store'} },
  );
}

export async function jsonBody(request: Request,maxBytes=65536,allowEmpty=false): Promise<Record<string, unknown>> {
  try {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new DomainError("REQUEST_TOO_LARGE","请求内容超过容量上限",413,true);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new DomainError("REQUEST_TOO_LARGE","请求内容超过容量上限",413,true); }
        chunks.push(value);
      }
    }
    if (size === 0 && allowEmpty) return {};
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError("INVALID_JSON", "请求内容必须是 JSON 对象", 400, true);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw new DomainError("INVALID_JSON", "请求内容不是有效 JSON", 400, true);
  }
}
