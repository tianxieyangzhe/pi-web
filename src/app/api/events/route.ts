import { resolveApplicationResource } from '@/bootstrap/application-events.server';
import { applicationEventResponse } from '@/shared/protocol/application-event-response.server';
import { errorResponse } from '@/shared/protocol/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  try { return applicationEventResponse(request, resolveApplicationResource); }
  catch (error) { return errorResponse(error); }
}
