import {database,assertSchemaCompatible} from "./database.server";
import {createProjectRepository} from "./project-repository";
export const projectRepository=createProjectRepository(database,assertSchemaCompatible);
