import {readFileSync} from "node:fs";
import {join} from "node:path";
const read=(name:string)=>readFileSync(join(process.cwd(),"src/infrastructure/database",name),"utf8");
export const botSchema=read("bot-schema.sql");
export const agentBindingSchema=read("agent-binding-schema.sql");
export const roleSchema=read("role-schema.sql");
export const coreSchema=read("core-schema.sql");
export const targetSchema=coreSchema+botSchema+agentBindingSchema+roleSchema;
