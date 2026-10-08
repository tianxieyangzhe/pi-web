import "server-only";

type ResponseSnapshot = {
  status: number;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
  expiresAt: number;
};

import { createHash } from "node:crypto";
const signatures=new Map<string,string>();
const records = new Map<string, Promise<ResponseSnapshot>>();
const streamingClaims = new Map<string, number>();
const ttlMs = 10 * 60 * 1000;
const maxRecords = 500;

function responseFrom(snapshot: ResponseSnapshot) {
  return new Response(snapshot.body.slice(0), {
    status: snapshot.status,
    headers: snapshot.headers,
  });
}

export function claimStreamingMutation(request: Request, scope: string) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return true;
  const now = Date.now();
  for (const [recordKey, expiresAt] of streamingClaims) {
    if (expiresAt <= now) streamingClaims.delete(recordKey);
  }
  const recordKey = `${scope}:${key}`;
  if (streamingClaims.has(recordKey)) return false;
  streamingClaims.set(recordKey, now + ttlMs);
  return true;
}

function prune() {
  const now = Date.now();
  for (const [key, promise] of records) {
    void promise.then((snapshot) => {
      if (snapshot.expiresAt <= now) {records.delete(key);signatures.delete(key);}
    });
  }
  while (records.size >= maxRecords) {
    const oldest = records.keys().next().value as string | undefined;
    if (!oldest) break;
    records.delete(oldest);signatures.delete(oldest);
  }
}

export async function idempotentMutation(
  request: Request,
  scope: string,
  operation: () => Promise<Response> | Response,
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return operation();
  if (key.length > 200) {
    return Response.json({
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key 不能超过 200 个字符",
        recoverable: true,
      },
    }, { status: 400 });
  }

  prune();
  const recordKey = `${scope}:${key}`;
  const signature=createHash("sha256").update(await request.clone().text()).digest("hex");
  if(signatures.has(recordKey)&&signatures.get(recordKey)!==signature)return Response.json({error:{code:"IDEMPOTENCY_CONFLICT",message:"相同幂等键不能用于不同请求内容",recoverable:true}},{status:409});
  signatures.set(recordKey,signature);
  let pending = records.get(recordKey);
  if (!pending) {
    pending = Promise.resolve(operation()).then(async (response) => {
      const snapshot = {
        status: response.status,
        headers: [...response.headers.entries()],
        body: await response.arrayBuffer(),
        expiresAt: Date.now() + ttlMs,
      } satisfies ResponseSnapshot;
      if (response.status >= 500) {records.delete(recordKey);signatures.delete(recordKey);}
      return snapshot;
    }).catch((error) => {
      records.delete(recordKey);
      throw error;
    });
    records.set(recordKey, pending);
  }
  return responseFrom(await pending);
}
