import { services } from "@/bootstrap/composition-root.server";
import { dataResponse, errorResponse } from "@/shared/protocol/api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try { return dataResponse(services.rooms.view((await params).roomId).runs); }
  catch (error) { return errorResponse(error); }
}
