import 'server-only';
import { createProjectFileService } from '@/application/project-file-service';
import { projectFiles } from '@/infrastructure/projects/project-files.server';

export const projectFileService = createProjectFileService(projectFiles);
