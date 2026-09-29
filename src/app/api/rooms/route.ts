import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    return dataResponse(services.rooms.list(projectId));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  return idempotentMutation(request, "rooms:create", async () => {
    try { return dataResponse(services.rooms.create(await jsonBody(request)), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
