import { projectSessionAction, type ProjectSessionContext } from '@/shared/protocol/project-session-api.server';
export const runtime = 'nodejs';
export function GET(request: Request, context: ProjectSessionContext) { return projectSessionAction(request, context, 'changes/content'); }
