export const attachmentOnlyMessage = "请查看本次附带的图片或文本。";
import { MAX_REFERENCE_FILE_BYTES, MAX_REFERENCE_TOTAL_BYTES, REFERENCE_SIZE_MESSAGE } from "../../../src/domain/message-reference-limits";
export function clipboardFiles(clipboard: Pick<DataTransfer, "items" | "getData"> & Partial<Pick<DataTransfer, "files">>): File[] | null {
  const items = Array.from(clipboard.items).filter(item => item.kind === "file");
  const files = items.length ? items.map(item => {
    const file = item.getAsFile();
    if (!file) throw new Error("无法读取剪贴板文件或图片");
    return file;
  }) : Array.from(clipboard.files ?? []);
  if (files.length) {
    for (const file of files) {
      if (file.type.startsWith("image/") && !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
        throw new Error("只支持 PNG、JPEG、GIF、WebP 图片");
      }
    }
    return files;
  }
  // Text-only pastes stay editable in the composer, regardless of their size.
  return null;
}
export function validateAttachments(files: readonly File[], projectCount: number) {
  if (files.length + projectCount > 10) throw new Error("最多选择 10 个参考文件");
  if (files.some(file => file.size > MAX_REFERENCE_FILE_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > MAX_REFERENCE_TOTAL_BYTES) throw new Error(REFERENCE_SIZE_MESSAGE);
}
