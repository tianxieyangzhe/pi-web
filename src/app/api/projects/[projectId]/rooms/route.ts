import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try { return dataResponse(services.rooms.list((await params).projectId)); }
  catch (error) { return errorResponse(error); }
}
