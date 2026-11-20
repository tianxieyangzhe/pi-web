import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import type { ImageFiles } from "@/application/ports/images";
import {
  bytesHash,
  imageError,
  isImageAssetDeleted,
  type OutputSpec,
  type StoredRow as Row,
} from "@/domain/images";
export function createImageFiles(
  root: string,
  store: {
    update: (table: "assets", id: string, patch: Row) => unknown;
    list?: (table: "assets", where: Record<string, unknown>) => Row[];
  },
): ImageFiles {
  const secret = randomBytes(32);
  root = path.resolve(root);
  const sign = (s: string) =>
    createHmac("sha256", secret).update(s).digest("base64url");
  async function safe(relative: string, make = false) {
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => !p || p === ".." || p === ".") ||
      relative.includes("\0")
    )
      imageError("IMAGE_RESOURCE_UNAVAILABLE", "资源路径无效");
    await fs.mkdir(root, { recursive: true });
    const rootStat = await fs.lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
      imageError("IMAGE_STORAGE_FAILED", "图片根目录无效", 503);
    const segments = relative.split("/");
    let current = root;
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]);
      if (make && index < segments.length - 1)
        await fs.mkdir(current).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      try {
        const stat = await fs.lstat(current);
        if (
          stat.isSymbolicLink() ||
          (index < segments.length - 1 && !stat.isDirectory())
        )
          imageError("IMAGE_RESOURCE_UNAVAILABLE", "拒绝符号链接或非目录资源");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (index < segments.length - 1 && !make) throw e;
      }
    }
    return current;
  }
  async function syncDirectory(directory: string) {
    const file = await fs.open(directory, constants.O_RDONLY);
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
  async function inspect(
    input: Uint8Array,
    maxBytes = 20 * 1024 * 1024,
    maxPixels = 40_960_000,
  ) {
    if (input.byteLength > maxBytes || !input.byteLength)
      imageError("IMAGE_PARAMETERS_INVALID", "图片须小于 20MiB 且非空", 422);
    const bytes = Buffer.from(input);
    const raster =
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
      (bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP");
    const svg = !raster;
    if (svg) {
      const text = bytes
        .toString("utf8")
        .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) =>
          String.fromCodePoint(
            Math.min(
              0x10ffff,
              parseInt(
                code[0].toLowerCase() === "x" ? code.slice(1) : code,
                code[0].toLowerCase() === "x" ? 16 : 10,
              ),
            ),
          ),
        );
      if (
        /<!DOCTYPE|<!ENTITY|<(?:[\w.-]+:)?(?:script|foreignObject|animate\w*|set|discard)\b|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(|@import|<\?xml-stylesheet|\\/i.test(
          text,
        )
      )
        imageError("IMAGE_PARAMETERS_INVALID", "SVG 包含脚本或外部资源", 422);
    }
    try {
      const image = sharp(bytes, {
        limitInputPixels: maxPixels,
        failOn: "warning",
      });
      const meta = await image.metadata();
      if (
        !["png", "jpeg", "webp", "svg"].includes(meta.format ?? "") ||
        !meta.width ||
        !meta.height ||
        (meta.pages ?? 1) > 1
      )
        imageError(
          "IMAGE_PARAMETERS_INVALID",
          "只接受单帧 PNG、JPEG、WebP 或安全 SVG",
          415,
        );
      if (svg || meta.format === "svg") {
        await image.clone().stats();
        return {
          bytes,
          mime: "image/svg+xml",
          width: meta.width,
          height: meta.height,
        };
      }
      // Decode now, rather than trusting metadata from a truncated image.
      await image.clone().stats();
      return {
        bytes,
        mime: `image/${meta.format}`,
        width: meta.width,
        height: meta.height,
      };
    } catch (e) {
      if (e instanceof Error && "code" in e) throw e;
      if (e instanceof Error && /pixel limit/i.test(e.message))
        imageError("REQUEST_TOO_LARGE", "图片像素超过上限", 413);
      if (!raster && e instanceof Error && /unsupported image format/i.test(e.message))
        imageError("IMAGE_PARAMETERS_INVALID", "只接受 PNG、JPEG、WebP 或安全 SVG", 415);
      return imageError("IMAGE_PARAMETERS_INVALID", "图片无法安全解码", 422);
    }
  }
  async function read(asset: Row) {
    if (isImageAssetDeleted(asset)) imageError("IMAGE_VERSION_DELETED", "图片已删除", 410);
    if (asset.availability !== "ready")
      imageError("IMAGE_RESOURCE_UNAVAILABLE", "图片资源不可用");
    let bytes: Buffer;
    try {
      const file = await fs.open(
        await safe(asset.relative_path),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== asset.byte_size) {
          store.update("assets", asset.id, { availability: "corrupt" });
          imageError("IMAGE_RESOURCE_UNAVAILABLE", "图片内容已改变");
        }
        bytes = await file.readFile();
      } finally {
        await file.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        store.update("assets", asset.id, { availability: "missing" });
        imageError("IMAGE_RESOURCE_UNAVAILABLE", "图片文件缺失");
      }
      throw e;
    }
    if (bytesHash(bytes) !== asset.sha256) {
      store.update("assets", asset.id, { availability: "corrupt" });
      imageError("IMAGE_RESOURCE_UNAVAILABLE", "图片校验失败");
    }
    return bytes;
  }
  return {
    inspect,
    read,
    async remove(asset) {
      const target = await safe(asset.relative_path);
      try {
        await fs.unlink(target);
        await syncDirectory(path.dirname(target));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
    async save(asset, input, beforeReady) {
      const info = await inspect(
        input,
        asset.role === "reference" ? 20 * 1024 * 1024 : 256 * 1024 * 1024,
        asset.role === "reference" ? 40_960_000 : 100_000_000,
      );
      const final = await safe(asset.relative_path, true);
      const staging = await safe(
        `${asset.task_id}/executions/${asset.execution_id ?? "references"}/staging/${asset.id}.part`,
        true,
      );
      try {
        const file = await fs.open(
          staging,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(info.bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        store.update("assets", asset.id, {
          sha256: bytesHash(info.bytes),
          mime_type: info.mime,
          width: info.width,
          height: info.height,
          byte_size: info.bytes.byteLength,
          sealed_at: new Date().toISOString(),
        });
        // UUID paths are reserved by SQL. Never overwrite an existing destination.
        try {
          await fs.lstat(final);
          imageError("IMAGE_STORAGE_FAILED", "目标文件已存在", 503);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await fs.rename(staging, final);
        await syncDirectory(path.dirname(staging));
        await syncDirectory(path.dirname(final));
        beforeReady?.();
        store.update("assets", asset.id, { availability: "ready" });
      } catch (e) {
        store.update("assets", asset.id, { availability: "missing" });
        throw e;
      }
    },
    async process(bytes, target, value) {
      const spec = value as OutputSpec;
      return sharp(bytes, { limitInputPixels: 40_960_000 })
        .rotate()
        .resize(target.width, target.height, {
          fit: spec.fit,
          background:
            spec.background === "transparent"
              ? { r: 0, g: 0, b: 0, alpha: 0 }
              : spec.background,
          kernel: "lanczos3",
        })
        .toFormat(spec.format, spec.quality ? { quality: spec.quality } : {})
        .toBuffer();
    },
    async candidates(taskId) {
      if (!/^[\da-f-]{36}$/i.test(taskId))
        imageError("NOT_FOUND", "任务不存在", 404);
      try {
        await safe(taskId + "/candidate-marker");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
      const registered = new Set(
        (store.list?.("assets", { task_id: taskId }) ?? []).map(
          (asset) => asset.relative_path,
        ),
      );
      const results: Array<{
        candidateId: string;
        name: string;
        sha256: string;
        bytes: number;
      }> = [];
      const directories = [taskId];
      while (directories.length) {
        const directory = directories.pop()!;
        const entries = await fs.readdir(await safe(directory), {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (entry.isSymbolicLink() || entry.name === "staging") continue;
          const relative = directory + "/" + entry.name;
          if (entry.isDirectory()) {
            directories.push(relative);
            continue;
          }
          if (
            !entry.isFile() ||
            !/\.(png|jpe?g|webp|svg)$/i.test(entry.name) ||
            registered.has(relative)
          )
            continue;
          const file = await fs.open(
            await safe(relative),
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          let bytes: Buffer;
          try {
            if ((await file.stat()).size > 20 * 1024 * 1024) continue;
            bytes = await file.readFile();
          } finally {
            await file.close();
          }
          try {
            await inspect(bytes);
          } catch {
            continue;
          }
          const sha256 = bytesHash(bytes);
          const payload = Buffer.from(
            JSON.stringify({ relative, sha256 }),
          ).toString("base64url");
          results.push({
            candidateId: payload + "." + sign(payload),
            name: relative.slice(taskId.length + 1),
            sha256,
            bytes: bytes.length,
          });
        }
      }
      return results;
    },
    async importCandidate(taskId, id, expected) {
      const [payload, signature, ...rest] = id.split(".");
      if (
        !payload ||
        !signature ||
        rest.length ||
        signature.length !== sign(payload).length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))
      )
        imageError("IMAGE_RESOURCE_CHANGED", "导入候选已失效");
      let candidate: { relative: string; sha256: string };
      try {
        candidate = JSON.parse(Buffer.from(payload, "base64url").toString());
      } catch {
        return imageError("INVALID_INPUT", "候选格式无效", 400);
      }
      if (
        !candidate.relative.startsWith(taskId + "/") ||
        candidate.sha256 !== expected
      )
        imageError("IMAGE_RESOURCE_CHANGED", "候选已变化");
      const file = await fs.open(
        await safe(candidate.relative),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: Buffer;
      try {
        if ((await file.stat()).size > 20 * 1024 * 1024)
          imageError("IMAGE_PARAMETERS_INVALID", "图片超过容量上限", 422);
        bytes = await file.readFile();
      } finally {
        await file.close();
      }
      if (bytesHash(bytes) !== expected)
        imageError("IMAGE_RESOURCE_CHANGED", "候选文件已变化");
      return { bytes, name: path.basename(candidate.relative) };
    },
  };
}
