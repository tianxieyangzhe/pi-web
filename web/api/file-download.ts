export async function readFileBlob(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message ?? '文件下载失败');
  }
  const blob = await response.blob(), length = response.headers.get('content-length');
  if (length === null || blob.size !== Number(length)) throw new Error('文件下载不完整，请重试');
  return blob;
}
export async function downloadFile(url: string, name: string) {
  const blob = await readFileBlob(url);
  const objectUrl = URL.createObjectURL(blob), anchor = document.createElement('a');
  try {
    anchor.href = objectUrl;
    anchor.download = name.split(/[\\/]/).pop() || 'download';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
