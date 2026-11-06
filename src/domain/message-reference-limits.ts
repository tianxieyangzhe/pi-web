// Shared by browser selection, API decoding, and server-side reference reads.
// OpenAI file input: each file < 50 MB, combined files <= 50 MB (decimal MB).
export const MAX_REFERENCE_FILE_BYTES = 50_000_000 - 1;
export const MAX_REFERENCE_TOTAL_BYTES = 50_000_000;
export const MAX_MESSAGE_BODY_BYTES = Math.ceil(MAX_REFERENCE_TOTAL_BYTES / 3) * 4 + 1_048_576;
export const REFERENCE_SIZE_MESSAGE = "参考文件单个须小于 50 MB，合计不能超过 50 MB";
