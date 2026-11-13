const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./workspace-fixture.cjs');
const { createWorkspaceService } = require('../src/application/workspace-service.ts');
const { createWorkspaceApi } = require('../src/shared/protocol/workspace-api.server.ts');
const { workspaceDirectories } = require('../src/infrastructure/workspaces/directories.server.ts');
let readers;
const original = Module._load;
try {
  Module._load = function (spec, ...args) {
    if (spec === '@/infrastructure/database/project-repository.server') return { projectRepository: { get() { throw new Error('Must not query independent projects'); } } };
    return original.call(this, spec, ...args);
  };
  readers = require('../src/infrastructure/workspaces/project-files.server.ts');
} finally { Module._load = original; }

test('workspace project files and Git diff HTTP APIs report capability, enforce membership and remain read-only', async () => {
  const f = fixture();
  const git = (...args) => execFileSync('git', ['-C', f.a, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const w = await f.service.save(null, { name: 'Work', projects: [{ rootPath: f.a }, { rootPath: f.b }], defaultProjectIndex: 0 }, 'workspace');
    const p = w.projects[0].id, nonGit = w.projects[1].id;
    const service = createWorkspaceService({ repository: f.repository, runtime: f.runtime, directories: workspaceDirectories,
      listFiles: (wid, pid, relative) => readers.listWorkspaceProjectFiles(f.repository.get(wid).projects, pid, relative),
      projectChanges: (wid, pid) => readers.readWorkspaceProjectChanges(f.repository.get(wid).projects, pid),
    });
    const handle = createWorkspaceApi(service);
    async function call(wid, pid, action) {
      const segments = [wid, 'projects', pid, action];
      const response = await handle(new Request(`http://localhost/api/workspaces/${segments.join('/')}`), segments);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, ...await response.json() };
    }
    fs.writeFileSync(path.join(f.a, 'code.ts'), 'const value = 1;\n');
    git('init', '--quiet');
    assert.equal((await call(w.id, p, 'files')).data.gitState, 'available');
    assert.equal((await call(w.id, p, 'changes')).data.workingPatch, '');
    git('add', 'code.ts');
    assert.match((await call(w.id, p, 'changes')).data.stagedPatch, /\+const value = 1;/);
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'baseline');
    fs.writeFileSync(path.join(f.a, 'code.ts'), 'const value = 2;\n'); git('add', 'code.ts');
    fs.writeFileSync(path.join(f.a, 'code.ts'), 'const value = 3;\n');
    const beforeIndex = fs.readFileSync(path.join(f.a, '.git', 'index'));
    const result = await call(w.id, p, 'changes');
    assert.equal(result.status, 200); assert.equal(result.data.isGitRepository, true);
    assert.match(result.data.stagedPatch, /\+const value = 2;/); assert.match(result.data.workingPatch, /\+const value = 3;/);
    assert.deepEqual(fs.readFileSync(path.join(f.a, '.git', 'index')), beforeIndex);
    assert.equal(fs.readFileSync(path.join(f.a, 'code.ts'), 'utf8'), 'const value = 3;\n');
    const listing = (await call(w.id, p, 'files')).data;
    assert.equal(listing.isGitRepository, true); assert.equal(listing.gitState, 'available');
    assert(!listing.entries.some(entry => entry.name === '.git'));
    assert.equal((await call(w.id, nonGit, 'files')).data.gitState, 'not_repository');
    assert.equal((await call(w.id, nonGit, 'changes')).data.isGitRepository, false);
    assert.equal((await call('other', p, 'changes')).status, 404);
    assert.equal((await call(w.id, 'foreign', 'changes')).status, 404);
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = path.join(f.root, 'no-executables');
      const unavailable = (await call(w.id, p, 'files')).data;
      assert.equal(unavailable.gitState, 'unavailable'); assert(unavailable.entries.some(entry => entry.name === 'code.ts'));
      const failed = await call(w.id, p, 'changes'); assert.equal(failed.status, 500); assert.equal(failed.error.code, 'GIT_READ_FAILED');
    } finally { if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath; }
    assert.equal(f.inputs.length, 0); assert.equal(f.sent.length, 0);
  } finally { f.close(); }
});
