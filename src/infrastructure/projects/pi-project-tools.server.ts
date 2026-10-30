import {isRoleSnapshot} from "@/domain/agent-definition";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SessionRuntimeInput } from "@/application/ports/pi-runtime";

const sensitiveNames = [
  /^\.env(?:\.|$)/i,
  /^\.git$/i,
  /^\.ssh$/i,
  /^\.aws$/i,
  /^\.codex$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^credentials?\./i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)/i,
  /^node_modules$/i,
];

function containsSensitiveName(absolutePath: string) {
  return absolutePath.split(path.sep).some((part) =>
    sensitiveNames.some((pattern) => pattern.test(part))
  );
}

function inside(root: string, target: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function realRoots(roots: string[]) {
  return Promise.all(roots.map((root) => fs.realpath(root)));
}

async function assertExistingPath(target: string, roots: string[]) {
  if (containsSensitiveName(target)) throw new Error("敏感文件不能由工作线访问");
  const [actual, allowedRoots] = await Promise.all([fs.realpath(target), realRoots(roots)]);
  if (!allowedRoots.some((root) => inside(root, actual))) {
    throw new Error("路径超出当前工作线允许的项目范围");
  }
  return actual;
}

async function assertPlannedPath(target: string, roots: string[]) {
  if (containsSensitiveName(target)) throw new Error("敏感文件不能由工作线访问");
  const absolute = path.resolve(target);
  const allowedRoots = await realRoots(roots);
  if (!allowedRoots.some((root) => inside(root, absolute))) {
    throw new Error("路径超出当前工作线允许的写入项目");
  }

  let ancestor = absolute;
  while (true) {
    let actualAncestor: string;
    try {
      actualAncestor = await fs.realpath(ancestor);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
      continue;
    }
    if (!allowedRoots.some((root) => inside(root, actualAncestor))) {
      throw new Error("路径经过了指向项目之外的符号链接");
    }
    return absolute;
  }
}

function renameTool<T extends { name: string; label: string; description: string }>(
  definition: T,
  name: string,
  description: string,
): T {
  return { ...definition, name, label: name, description };
}

function toolAllowed(input: SessionRuntimeInput, name: string) {
  if (input.independentProjectTools) return true;
  const s=input.session.agentSnapshot;
  if(isRoleSnapshot(s))return (name==='read'||name==='ls')?s.definition.capabilities.readFiles:s.definition.capabilities.writeFiles;
  return false;
}

export async function createPiProjectTools(
  input: SessionRuntimeInput,
): Promise<ToolDefinition<any, any, any>[]> {
  const readRoots = [input.workingDirectory];

  const readOperations = {
    async readFile(target: string) {
      return fs.readFile(await assertExistingPath(target, readRoots));
    },
    async access(target: string) {
      await fs.access(await assertExistingPath(target, readRoots));
    },
  };
  const listOperations = {
    async exists(target: string) {
      try { await assertExistingPath(target, readRoots); return true; }
      catch { return false; }
    },
    async stat(target: string) {
      return fs.stat(await assertExistingPath(target, readRoots));
    },
    async readdir(target: string) {
      return fs.readdir(await assertExistingPath(target, readRoots));
    },
  };

  // Pi's ToolDefinition defaults are invariant; the concrete schemas remain
  // intact at runtime and are validated by Pi before execute is called.
  const tools: ToolDefinition<any, any, any>[] = [];
  if (input.allowProjectRead!==false&&toolAllowed(input, "read")) {
    tools.push(renameTool(
      createReadToolDefinition(input.workingDirectory, { operations: readOperations }),
      "project_read",
      "读取当前项目工作线绑定项目中的文件。",
    ));
  }
  if (input.allowProjectRead!==false&&toolAllowed(input, "ls")) {
    tools.push(renameTool(
      createLsToolDefinition(input.workingDirectory, { operations: listOperations }),
      "project_list",
      "列出当前工作线已绑定项目中的目录内容。",
    ));
  }

  if (!input.allowProjectWrite) return tools;
  const writeRoots = [input.workingDirectory];
  const editOperations = {
    async readFile(target: string) {
      return fs.readFile(await assertExistingPath(target, writeRoots));
    },
    async writeFile(target: string, content: string) {
      await fs.writeFile(await assertPlannedPath(target, writeRoots), content, "utf8");
    },
    async access(target: string) {
      await fs.access(await assertExistingPath(target, writeRoots), fs.constants.R_OK | fs.constants.W_OK);
    },
  };
  const writeOperations = {
    async writeFile(target: string, content: string) {
      await fs.writeFile(await assertPlannedPath(target, writeRoots), content, "utf8");
    },
    async mkdir(target: string) {
      await fs.mkdir(await assertPlannedPath(target, writeRoots), { recursive: true });
    },
  };
  if (toolAllowed(input, "edit")) {
    tools.push(renameTool(
      createEditToolDefinition(input.workingDirectory, { operations: editOperations }),
      "project_edit",
      "精确修改当前项目内的现有文件。",
    ));
  }
  if (toolAllowed(input, "write")) {
    tools.push(renameTool(
      createWriteToolDefinition(input.workingDirectory, { operations: writeOperations }),
      "project_write",
      "在当前项目内创建或完整重写文件。",
    ));
  }
  return tools;
}
