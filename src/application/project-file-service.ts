import { DomainError } from '@/domain/errors';
import type { FileDownload, FilePreview } from '@/domain/file-preview';

type ProjectFiles = {
  read(projectId: string, relative: string): FilePreview;
  download(projectId: string, relative: string): FileDownload;
};
function requiredPath(relative: string | null) {
  if (!relative) throw new DomainError('INVALID_PATH', '缺少文件相对路径', 400, true);
  return relative;
}
export function createProjectFileService(files: ProjectFiles) {
  return {
    read: (projectId: string, relative: string | null) => files.read(projectId, requiredPath(relative)),
    download: (projectId: string, relative: string | null) => files.download(projectId, requiredPath(relative)),
  };
}
