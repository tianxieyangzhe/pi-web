import { DomainError } from "@/domain/errors";
const state = globalThis as typeof globalThis & { __sessionLocks?: Set<string> };
export const sessionLocks = state.__sessionLocks ??= new Set<string>();
export function acquireSession(id: string) { if (sessionLocks.has(id)) throw new DomainError("SESSION_BUSY", "Session 正在回答或压缩", 409, true); sessionLocks.add(id); }
const roots=globalThis as typeof globalThis & {__projectWriteRoots?:Set<string>};
export const projectWriteRoots=roots.__projectWriteRoots??=new Set<string>();
export function acquireProjectWrite(root:string){if(projectWriteRoots.has(root))throw new DomainError('PROJECT_BUSY','同一目录正在修改，请等待当前工作结束',409,true);projectWriteRoots.add(root);}
