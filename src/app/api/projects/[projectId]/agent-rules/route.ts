import {projectRulesService} from '@/bootstrap/project-rules.server';
import {createProjectRulesApi} from '@/shared/protocol/project-rules-api.server';
export const runtime='nodejs';
const handle=createProjectRulesApi(projectRulesService);
async function route(request:Request,{params}:{params:Promise<{projectId:string}>}){return handle(request,{scope:'project',projectId:(await params).projectId});}
export {route as GET,route as PUT,route as POST,route as PATCH};
