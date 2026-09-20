import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return dataResponse(services.workspaces.list());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return idempotentMutation(request, "workspaces:create", async () => {
    try { return dataResponse(services.workspaces.create(await jsonBody(request)), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
