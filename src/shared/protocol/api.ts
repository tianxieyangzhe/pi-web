import { DomainError, isDomainError } from "@/domain/errors";

export type ApiError = {
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    fieldErrors?: Record<string, string[]>;
  };
};

export function dataResponse<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
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
        },
      } satisfies ApiError,
      { status: error.status },
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
    { status: 500 },
  );
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536) throw new DomainError("INVALID_INPUT","请求内容超过 64KiB",413,true);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError("INVALID_JSON", "请求内容必须是 JSON 对象", 400, true);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw new DomainError("INVALID_JSON", "请求内容不是有效 JSON", 400, true);
  }
}
