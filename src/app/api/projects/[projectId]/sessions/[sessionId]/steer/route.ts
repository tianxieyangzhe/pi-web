import { projectSessionAction, type ProjectSessionContext } from '@/shared/protocol/project-session-api.server';
export const runtime = 'nodejs';
export async function POST(request: Request, context: ProjectSessionContext) { return projectSessionAction(request, context, 'steer'); }
