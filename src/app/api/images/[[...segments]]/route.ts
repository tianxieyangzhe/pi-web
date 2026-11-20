import { getImageWorkbench } from "@/bootstrap/images.server";
import { createImageApi } from "@/shared/protocol/image-api.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) {
  const segments = (await context.params).segments ?? [];
  return createImageApi(getImageWorkbench())(request, segments);
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
