export const attachmentOnlyMessage = "请查看本次附带的图片或文本。";
export function pastedLineCount(text: string) { return text.split(/\r\n|\r|\n/).length; }
export function clipboardFiles(clipboard: Pick<DataTransfer, "items" | "getData">): File[] | null {
  const images = Array.from(clipboard.items).filter(item => item.kind === "file" && item.type.startsWith("image/"));
  if (images.length) {
    return images.map((item, index) => {
      const file = item.getAsFile();
      if (!file) throw new Error("无法读取剪贴板图片");
      const extension = ({"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp"} as Record<string, string>)[file.type];
      if (!extension) throw new Error("只支持 PNG、JPEG、GIF、WebP 图片");
      return new File([file], `粘贴图片-${Date.now()}-${index + 1}.${extension}`, { type: file.type });
    });
  }
  const text = clipboard.getData("text/plain"), lines = pastedLineCount(text);
  return lines > 10 || text.length > 1000 ? [new File([text], `已粘贴 ${lines} 行.txt`, {type:"text/plain;charset=utf-8"})] : null;
}
export function validateAttachments(files: readonly File[], projectCount: number) {
  if (files.length + projectCount > 10) throw new Error("最多选择 10 个参考文件");
  if (files.some(file => file.size > 2 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error("参考文件单个不能超过 2 MiB，合计不能超过 8 MiB");
}
