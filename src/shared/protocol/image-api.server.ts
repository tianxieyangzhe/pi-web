import { Zip, ZipPassThrough, zipSync } from "fflate";
import { dataResponse, errorResponse, jsonBody } from "./api";
import {
  canonical,
  hash,
  imageError,
  integer,
  type StoredRow as Row,
} from "@/domain/images";
import type {
  ImageWorkbenchService,
  ImageIntent,
} from "@/application/image-workbench-service";
function query(request: Request, allowed: string[]) {
  const q = new URL(request.url).searchParams;
  for (const k of q.keys())
    if (!allowed.includes(k) || q.getAll(k).length !== 1)
      imageError("INVALID_INPUT", "查询包含未知或重复参数", 400);
  return q;
}
const limit = (q: URLSearchParams, key = "limit") =>
  integer(Number(q.get(key) ?? 30), 1, 100);
const intent = (r: Request): ImageIntent => ({
  key: r.headers.get("Idempotency-Key") ?? "",
  match: r.headers.get("If-Match"),
});
async function readImageForm(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length")) > maximum)
    imageError("REQUEST_TOO_LARGE", "文件超过容量上限", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maximum) {
          void reader.cancel().catch(() => {});
          imageError("REQUEST_TOO_LARGE", "文件超过容量上限", 413);
        }
        chunks.push(value);
      }
    }
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (error instanceof TypeError) imageError("INVALID_INPUT", "multipart 表单无效", 400);
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
export function createImageApi(service: ImageWorkbenchService) {
  return async function handle(
    request: Request,
    segments: string[] = [],
  ): Promise<Response> {
    try {
      const method = request.method;
      const [resource, id, action] = segments;
      const length = segments.length;
      if (method === "GET") {
        if (resource === "capabilities" && length === 1) {
          query(request, []);
          return dataResponse(await service.capabilities());
        }
        if (resource === "events" && length === 1)
          return events(request, service);
        if (resource === "conversations" && id && length === 2) {
          query(request, []);
          return dataResponse(service.getConversation(id));
        }
        if (
          resource === "conversations" &&
          id &&
          action === "draft" &&
          length === 3
        ) {
          const q = query(request, ["taskId"]);
          return dataResponse(service.getDraft(id, q.get("taskId")));
        }
        if (
          resource === "conversations" &&
          id &&
          action === "messages" &&
          length === 3
        ) {
          query(request, []);
          return dataResponse(service.tree(id));
        }
        if (resource === "tasks" && length === 1) {
          const q = query(request, [
            "filter",
            "conversationId",
            "cursor",
            "limit",
          ]);
          return dataResponse(
            service.listTasks(
              q.get("filter") ?? "all",
              q.get("conversationId"),
              q.get("cursor"),
              limit(q),
            ),
          );
        }
        if (resource === "tasks" && id && length === 2) {
          query(request, []);
          return dataResponse(service.getTask(id));
        }
        if (
          resource === "tasks" &&
          id &&
          action === "import-candidates" &&
          length === 3
        ) {
          const q = query(request, ["cursor", "limit"]);
          return dataResponse(
            await service.candidates(id, q.get("cursor"), limit(q)),
          );
        }
        if (resource === "commands" && id && length === 2) {
          query(request, []);
          return dataResponse(service.getCommand(id));
        }
        if (resource === "executions" && id && length === 2) {
          query(request, []);
          return dataResponse(service.getExecution(id));
        }
        if (resource === "assets" && length === 1) {
          const q = query(request, ["taskId", "cursor", "limit"]);
          return dataResponse(
            service.listAssets(q.get("taskId"), q.get("cursor"), limit(q)),
          );
        }
        if (
          resource === "assets" &&
          id &&
          action === "content" &&
          length === 3
        ) {
          const q = query(request, ["download"]);
          if (q.has("download") && q.get("download") !== "1")
            imageError("INVALID_INPUT", "下载参数无效", 400);
          const { asset, bytes } = await service.content(id);
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": asset.mimeType,
              "Content-Length": String(bytes.length),
              "Content-Disposition": `${q.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
              "Cache-Control": "no-store, no-transform",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
        }
        if (
          resource === "executions" &&
          id &&
          action === "download" &&
          length === 3
        ) {
          query(request, []);
          const files = service.download(id);
          let zip: Zip;
          let closed = false;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              zip = new Zip((error, chunk, final) => {
                if (closed) return;
                if (error) {
                  closed = true;
                  controller.error(error);
                  return;
                }
                controller.enqueue(chunk);
                if (final) {
                  closed = true;
                  controller.close();
                }
              });
            },
            async pull(controller) {
              if (closed) return;
              try {
                const { done, value } = await files.next();
                if (closed) return;
                if (done) {
                  zip.end();
                  return;
                }
                const entry = new ZipPassThrough(value.name);
                zip.add(entry);
                entry.push(value.bytes, true);
              } catch (error) {
                closed = true;
                zip.terminate();
                controller.error(error);
              }
            },
            async cancel() {
              closed = true;
              zip.terminate();
              await files.return();
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="images-${id}.zip"`,
              "Cache-Control": "no-store, no-transform",
            },
          });
        }
      }
      if (method === "POST" && resource === "tasks" && action === "download" && length === 3) {
        query(request, []);
        const files = await service.downloadVersions(id, await jsonBody(request, 256 * 1024));
        const bytes = zipSync(Object.fromEntries(files.map(file => [file.name, file.bytes])), {level: 0});
        return new Response(new Uint8Array(bytes), {headers: {"Content-Type": "application/zip", "Content-Disposition": `attachment; filename="images-${id}.zip"`, "Cache-Control": "no-store"}});
      }
      if (method === "DELETE" && resource === "tasks" && action === "versions" && length === 4) {
        query(request, []);
        return dataResponse(await service.deleteVersion(id, segments[3], await jsonBody(request, 256 * 1024), intent(request)));
      }
      if (method === "POST" || method === "PATCH") {
        // Unknown actions are rejected before parsing input; there is no cancel/delete/recovery endpoint.
        const known =
          method === "PATCH"
            ? resource === "conversations" && action === "draft" && length === 3
            : (resource === "conversations" &&
                (length === 1 ||
                  (length === 2 && id === "submit") ||
                  (length === 3 && ["messages", "tasks"].includes(action)))) ||
              (resource === "tasks" &&
                length === 3 &&
                [
                  "references",
                  "import",
                  "plans",
                  "confirm",
                  "interrupt",
                ].includes(action)) ||
              (["commands", "executions"].includes(resource) &&
                action === "restart" &&
                length === 3);
        if (!known) imageError("NOT_FOUND", "接口不存在", 404);
        query(request, []);
        const i = intent(request);
        if (!i.key)
          imageError("IDEMPOTENCY_KEY_REQUIRED", "需要 Idempotency-Key", 400);
        if (resource === "conversations" && id === "submit") {
          const form = await readImageForm(request, 81 * 1024 * 1024);
          const payload = form.get("payload");
          const files = form.getAll("files");
          if ([...form.keys()].some(k => k !== "payload" && k !== "files") ||
              form.getAll("payload").length !== 1 || typeof payload !== "string" ||
              files.length > 4 || files.some(file => !(file instanceof File)))
            imageError("INVALID_INPUT", "需要一个 JSON payload 及最多四个 files", 400);
          if (Buffer.byteLength(payload) > 256 * 1024 || files.some(file => (file as File).size > 20 * 1024 * 1024))
            imageError("REQUEST_TOO_LARGE", "首次提交超过容量上限", 413);
          let input: unknown;
          try { input = JSON.parse(payload); } catch { imageError("INVALID_INPUT", "payload 必须是有效 JSON", 400); }
          return dataResponse(await service.submit(input, await Promise.all((files as File[]).map(async file => ({
            name: file.name, bytes: new Uint8Array(await file.arrayBuffer()),
          }))), i), { status: 202 });
        }
        if (resource === "tasks" && action === "references") {
          const form = await readImageForm(request, 21 * 1024 * 1024);
          if (
            [...form.keys()].some((k) => k !== "file") ||
            form.getAll("file").length !== 1
          )
            imageError("INVALID_INPUT", "只接受一个 file 字段", 400);
          const file = form.get("file");
          if (!(file instanceof File))
            imageError("INVALID_INPUT", "缺少图片文件", 400);
          return dataResponse(
            await service.upload(
              id,
              file.name,
              new Uint8Array(await file.arrayBuffer()),
              i,
            ),
            { status: 201 },
          );
        }
        const body = await jsonBody(request, 256 * 1024);
        if (method === "PATCH")
          return dataResponse(service.saveDraft(id, body, i));
        if (resource === "conversations" && length === 1) {
          const result = await service.createConversation(body, i);
          return dataResponse(result, {
            status: ["accepted", "running"].includes(result.command.status)
              ? 202
              : 201,
          });
        }
        if (resource === "conversations" && action === "tasks")
          return dataResponse(service.createTask(id, body, i), { status: 201 });
        if (resource === "conversations" && action === "messages")
          return dataResponse(await service.message(id, body, i), {
            status: 202,
          });
        if (resource === "tasks" && action === "interrupt")
          return dataResponse(await service.interrupt(id, body, i));
        if (resource === "tasks" && action === "confirm")
          return dataResponse(await service.confirm(id, body, i), {
            status: 202,
          });
        if (resource === "tasks" && action === "plans") {
          const { created, ...result } = await service.preparePlan(id, body, i);
          return dataResponse(result, { status: created ? 201 : 200 });
        }
        if (resource === "tasks" && action === "import")
          return dataResponse(await service.import(id, body, i), {
            status: 201,
          });
        if (resource === "executions" && action === "restart")
          return dataResponse(await service.restartExecution(id, body, i), {
            status: 202,
          });
        if (resource === "commands" && action === "restart")
          return dataResponse(await service.restartCommand(id, body, i), {
            status: 202,
          });
      }
      imageError("NOT_FOUND", "接口不存在", 404);
    } catch (error) {
      const response = errorResponse(error);
      if (error && typeof error === "object" && "commandId" in error) {
        const body = await response.json();
        body.error.commandId = error.commandId;
        return Response.json(body, {
          status: response.status,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return response;
    }
  };
}
function events(request: Request, service: ImageWorkbenchService) {
  const q = query(request, [
    "conversations",
    "filter",
    "taskId",
    "cursor",
    "limit",
  ]);
  let ids: unknown;
  try {
    ids = JSON.parse(q.get("conversations") ?? "[]");
  } catch {
    return imageError("INVALID_INPUT", "讨论订阅列表无效", 400);
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 16 ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  )
    imageError("INVALID_INPUT", "讨论订阅最多 16 项且不可重复", 400);
  const conversations = ids as string[];
  const taskId = q.get("taskId");
  const filter = q.get("filter") ?? "all", cursor = q.get("cursor"), pageLimit = limit(q);
  const taskConversationId = service.validateSubscription(conversations, taskId, filter, cursor, pageLimit);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false,
        running = false,
        dirty = false;
      const revisions = new Map<string, string>();
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };
      const send = (type: string, data: unknown) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) < -32) {
          close();
          return;
        }
        controller.enqueue(
          encoder.encode(`event: ${type}\ndata: ${canonical(data)}\n\n`),
        );
      };
      const resource = (name: string, read: () => unknown, resourceName?: (data: any) => string) => {
        const key = name;
        try {
          const data = read();
          if(resourceName)name=resourceName(data);
          const revision = hash(data);
          if (revisions.get(key) === revision) return;
          revisions.set(key, revision);
          send("snapshot", { resource: name, revision, data });
        } catch (error) {
          revisions.delete(key);
          send("resource_error", {
            resource: name,
            error: {
              message: error instanceof Error && "code" in error ? error.message : "图片资源暂时不可用",
              code:
                error && typeof error === "object" && "code" in error
                  ? error.code
                  : "IMAGE_RESOURCE_UNAVAILABLE",
            },
          });
        }
      };
      const refresh = () => {
        dirty = true;
        if (running) return;
        running = true;
        queueMicrotask(() => {
          try {
            if (closed) return;
            dirty = false;
            resource("tasks", () =>
              service.listTasks(filter, null, cursor, pageLimit),
            );
            for (const id of conversations) {
              resource(`conversation:${id}`, () => service.getConversation(id));
              resource(`tree:${id}`, () => service.tree(id, true));
              resource(`draft:${taskId ?? id}`, () => service.getDraftSnapshot(
                id,
                taskId && taskConversationId === id
                  ? taskId
                  : null,
              ), snapshot => `draft:${snapshot.draft.id}`);
            }
            if (taskId)
              resource(`task:${taskId}`, () => service.getTask(taskId));
          } finally {
            running = false;
            if (dirty && !closed) refresh();
          }
        });
      };
      const heartbeat = setInterval(() => {
        if (!closed) {
          if ((controller.desiredSize ?? 0) < -32) {
            close();
            return;
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 15000);
      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        service.changes.off("change", refresh);
        request.signal.removeEventListener("abort", close);
      };
      service.changes.on("change", refresh);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
      else refresh();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
