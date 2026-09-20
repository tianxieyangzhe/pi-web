import { DomainError } from "@/domain/errors";

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
  if (error instanceof DomainError) {
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
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError("INVALID_JSON", "请求内容必须是 JSON 对象", 400, true);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_JSON", "请求内容不是有效 JSON", 400, true);
  }
}
