import { createWorkspaceApi } from '@/shared/protocol/workspace-api.server';
import { workspaceServices } from '@/bootstrap/workspace.server';
const handleWorkspaceApi = createWorkspaceApi(workspaceServices);
export const runtime = 'nodejs';
type Context = {params:Promise<{segments?:string[]}>};
async function handle(request:Request,context:Context) {return handleWorkspaceApi(request,(await context.params).segments??[]);}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
