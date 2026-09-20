import { services } from "@/bootstrap/composition-root.server";
import { DomainError } from "@/domain/errors";
import { errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ mcpId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const mcp = services.catalog.getMcp((await params).mcpId);
    if (!mcp) throw new DomainError("NOT_FOUND", "MCP 不存在", 404, true);
    throw new DomainError(
      "MCP_RUNTIME_UNAVAILABLE",
      "官方 MCP v2 客户端尚未安装，当前不能测试连接",
      503,
      true,
    );
  } catch (error) { return errorResponse(error); }
}
