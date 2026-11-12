import { projectSessionAction, type ProjectSessionContext } from '@/shared/protocol/project-session-api.server';
export const GET=(request:Request,context:ProjectSessionContext)=>projectSessionAction(request,context,'assistant');
export const PUT=(request:Request,context:ProjectSessionContext)=>projectSessionAction(request,context,'assistant');
