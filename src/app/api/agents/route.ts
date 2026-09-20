import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse, jsonBody } from "@/shared/protocol/api";
import { idempotentMutation } from "@/shared/protocol/idempotency.server";

export const runtime = "nodejs";

export async function GET() {
  try { return dataResponse(services.catalog.listAgents()); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  return idempotentMutation(request, "agents:create", async () => {
    try { return dataResponse(services.catalog.createAgent(await jsonBody(request)), { status: 201 }); }
    catch (error) { return errorResponse(error); }
  });
}
