import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { projectRepository } from "../database/project-repository.server";
const excluded = /^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|\.codex$|node_modules$|dist$|build$|\.next$|\.data$|vendor$|credentials?|id_(rsa|ed25519)|\.npmrc|\.pypirc)/i;
export async function collectMaterialsFromRoot(rootPath: string, signal?: AbortSignal, requirements = '') {
  const root = await fs.realpath(rootPath),
    sources: Array<{
      path: string;
      hash: string;
      content: string;
    }> = [],
    warnings: string[] = [],
    structure: string[] = [];
  const check = () => {
    if (signal?.aborted) throw new DomainError('REQUEST_ABORTED', '材料读取已取消', 409, true);
  };
  let enumerated = 0,
    bytes = 0;
  const found = new Set<string>();
  async function list(relative: string, depth: number) {
    check();
    let entries = await fs.readdir(path.join(root, relative), {
      withFileTypes: true
    });
    entries = entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      check();
      if (++enumerated > 300) {
        warnings.push('目录概览达到 300 条上限，未遍历其余路径');
        return;
      }
      if (excluded.test(entry.name) || entry.isSymbolicLink()) continue;
      const rel = relative ? relative + '/' + entry.name : entry.name;
      structure.push(rel + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory() && depth < 2) await list(rel, depth + 1);else if (entry.isFile()) found.add(rel);
    }
  }
  await list('', 0);
  check();
  const priority = ['README.md', 'AGENTS.md', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml'];
  const words = requirements.toLowerCase().split(/\s+/).filter(x => x.length > 2);
  const additional = [...found].filter(p => /\.(md|ts|tsx|go|rs|py|json|ya?ml)$/i.test(p)).sort((a, b) => {
    const score = (p: string) => words.reduce((n, w) => n + (p.toLowerCase().includes(w) ? 5 : 0), 0) + (/(?:architecture|design|架构|设计)/i.test(p) ? 4 : 0) + (/(?:^|\/)(?:main|index|app|server)\.[^/]+$/i.test(p) ? 2 : 0);
    return score(b) - score(a) || a.localeCompare(b);
  });
  const paths = [...new Set([...priority, ...additional])];
  const add = (relative: string, content: string) => sources.push({
    path: relative,
    content,
    hash: createHash('sha256').update(content).digest('hex')
  });
  const overview = structure.slice(0, 120).join('\n');
  if (overview) add('[项目结构概览]', overview);
  for (const relative of paths) {
    check();
    if (sources.filter(x => x.path !== '[项目结构概览]').length >= 10) {
      warnings.push('文件采集达到 10 项上限，其余文件未覆盖');
      break;
    }
    try {
      const candidate = path.join(root, relative),
        actual = await fs.realpath(candidate);
      if (!(actual === root || actual.startsWith(root + path.sep)) || path.relative(root, actual).split(path.sep).some(n => excluded.test(n))) {
        warnings.push(relative + ' 排除：路径范围');
        continue;
      }
      const stat = await fs.stat(actual);
      if (!stat.isFile() || stat.size > 65536 || bytes + stat.size > 262144) {
        warnings.push(relative + ' 未读取：文件预算');
        continue;
      }
      const buffer = await fs.readFile(actual, {
        signal
      });
      bytes += buffer.length;
      check();
      let content: string;
      try {
        content = new TextDecoder('utf-8', {
          fatal: true
        }).decode(buffer);
      } catch {
        warnings.push(relative + ' 未纳入：非 UTF-8 文本');
        continue;
      }
      if (content.includes('\0')) continue;
      if (/(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----|Bearer\s+\S{12,}|(?:API_KEY|PASSWORD|SECRET|ACCESS_TOKEN)\s*[:=]\s*["']?[^\s"'$<{]{8,})/.test(content)) {
        warnings.push(relative + ' 未纳入：可能包含凭据');
        continue;
      }
      const projected = JSON.stringify([...sources, {
        path: relative,
        content
      }]);
      if (Buffer.byteLength(projected) > 8800) {
        warnings.push(relative + ' 未纳入：模型预算（保留完整文件）');
        continue;
      }
      add(relative, content);
    } catch (e) {
      check();
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(relative + ' 未读取：不可访问');
    }
  }
  if (sources.every(s => s.path === '[项目结构概览]')) throw new DomainError('ROLE_MATERIALS_UNAVAILABLE', '项目没有可纳入预算的资料，请完善项目 README', 422, true);
  warnings.push('仅覆盖列出的文件与有界概览，未分析全仓库/目录外共享依赖。');
  return {
    sources,
    warnings
  };
}
export async function collectAgentMaterials(projectId: string, signal?: AbortSignal, requirements = '') {
  const p = projectRepository.get(projectId);
  if (!p || p.status !== 'active') throw new DomainError('PROJECT_UNAVAILABLE', '参考项目不可用', 409, true);
  return collectMaterialsFromRoot(p.rootPath, signal, requirements);
}
