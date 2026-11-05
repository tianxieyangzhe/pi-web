import {database,assertSchemaCompatible} from "./database.server";
import {createAgentRepository} from "./agent-repository";
export const agentRepository=createAgentRepository(database,assertSchemaCompatible);
