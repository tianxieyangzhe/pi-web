import fs from "node:fs";
import path from "node:path";
import {DomainError} from "@/domain/errors";
import {safeOutputPath,type SessionMemoryContext} from "@/domain/session-memory";
export function validateSessionMemoryPaths(context:SessionMemoryContext,root:string){
  const actualRoot=fs.realpathSync(root);
  for(const output of context.outputs){if(output.path===null)continue;safeOutputPath(output.path);let current=path.join(actualRoot,output.path);while(!fs.existsSync(current)&&current!==actualRoot)current=path.dirname(current);const actual=fs.realpathSync(current);const relative=path.relative(actualRoot,actual);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new DomainError('PATH_OUTSIDE_PROJECT','产出路径指向项目之外',422,true);if(relative&&relative.split(path.sep).some(segment=>/^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|credentials?\.)/i.test(segment)))throw new DomainError('SENSITIVE_PATH','产出路径涉及敏感文件',422,true);}
}
