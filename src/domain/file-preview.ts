export type FileBlock =
  | { type: 'paragraph' | 'code'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'table'; rows: string[][] };

export type FilePreview = {
  path: string;
  content: string;
  size: number;
  format?: 'text' | 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'binary';
  blocks?: FileBlock[];
  notice?: string;
};
export type FileDownload = { name: string; bytes: Uint8Array };
export const MAX_DOWNLOAD_BYTES = 50_000_000;
