import {createHash} from "node:crypto";
import {dataResponse} from "./api";
export function sessionMemoryResponse(value:unknown,request:Request){const etag=`"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;if(request.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:{etag}});return dataResponse(value,{headers:{etag,"cache-control":"private, no-cache"}});}
