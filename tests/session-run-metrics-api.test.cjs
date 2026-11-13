require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./workspace-fixture.cjs');
const { createSessionExecutionService } = require('../src/application/session-execution-service.ts');
const { createWorkspaceService } = require('../src/application/workspace-service.ts');
const { createProjectRepository } = require('../src/infrastructure/database/project-repository.ts');
const { createSessionRepository } = require('../src/infrastructure/database/session-repository.ts');
const { workspaceDirectories } = require('../src/infrastructure/workspaces/directories.server.ts');
const { DomainError } = require('../src/domain/errors.ts');
const tick = () => new Promise(setImmediate);
const usage = (n) => ({ input: n, output: 2*n, cacheRead: 3*n, cacheWrite: 4*n, totalTokens: 10*n, reasoning: n });

for (const scope of ['project', 'workspace']) test(`${scope} messages API returns session-wide usage including branches, compaction and cold reads`, async () => {
  const f = fixture();
  let service, owner, id;
  let entries = [], reads = 0;
  f.runtime.readTree = async () => { reads++; return { entries, activeLeafId: entries.at(-1)?.entry.id ?? null }; };
  try {
    if (scope === 'project') {
      const projects = createProjectRepository(f.db), sessions = createSessionRepository(f.db);
      owner = projects.create({ name: 'P', description: null, kind: 'code', rootPath: f.a, status: 'active' }).id;
      id = sessions.create({ projectId: owner, purpose: '', agentId: null, agentSnapshot: null, mcpIds: [], mcpSnapshots: [] }).id;
      service = createSessionExecutionService({ sessions, projects, catalog: {}, runtime: f.runtime });
      await service.open(id, 'open');
    } else {
      service = createWorkspaceService({ repository: f.repository, runtime: f.runtime, directories: workspaceDirectories });
      owner = (await service.save(null, { name: 'W', projects: [{ rootPath: f.a }], defaultProjectIndex: 0 }, 'create')).id;
      id = service.createSession(owner, {}, 'create').id;
      assert.deepEqual((await service.messages(owner, id)).tokenUsage, { totalTokens: 0, complete: true });
      await service.open(owner, id);
    }
    const read = () => scope === 'project' ? service.messages(id) : service.messages(owner, id);
    assert.deepEqual((await read()).tokenUsage, { totalTokens: 0, complete: true });
    const entry = (id, parentId, rest) => ({ entry: { id, parentId, timestamp: new Date().toISOString(), ...rest }, label: null, labelTimestamp: null });
    entries = [
      entry('user', null, { type: 'message', message: { role: 'user', usage: usage(1000) } }),
      entry('branch-a', 'user', { type: 'message', message: { role: 'assistant', usage: usage(1) } }),
      entry('branch-b', 'user', { type: 'message', message: { role: 'assistant', usage: usage(2) } }),
      entry('compact', 'branch-b', { type: 'compaction', usage: usage(3), tokensBefore: 999999 }),
      entry('summary', 'compact', { type: 'branch_summary', usage: usage(4) }),
      entry('native-usage', 'summary', { type: 'usage', usage: usage(5) }),
      entry('tool', 'native-usage', { type: 'message', message: { role: 'toolResult', usage: usage(6) } }),
      entry('tool-no-usage', 'tool', { type: 'message', message: { role: 'toolResult' } }),
    ];
    const before = reads, result = await read();
    assert.equal(reads, before+1, 'reuse a single tree read');
    assert.equal(result.entries.length, 8, 'preserve all original nodes');
    assert.deepEqual(result.tokenUsage, { totalTokens: 210, complete: true });
    assert.deepEqual((await read()).tokenUsage, result.tokenUsage, 'repeat reads do not double count');
    await f.runtime.close(f.runtime.getHandle(id));
    assert.deepEqual((await read()).tokenUsage, result.tokenUsage, 'read persisted entries without a live handle');
    entries.push(entry('legacy', 'tool-no-usage', { type: 'message', message: { role: 'assistant' } }));
    assert.deepEqual((await read()).tokenUsage, { totalTokens: 210, complete: false });
    entries = [entry('unknown', null, { type: 'message', message: { role: 'assistant', usage: { ...usage(1), input: -1 } } })];
    assert.deepEqual((await read()).tokenUsage, { totalTokens: null, complete: false });
    await assert.rejects(() => scope === 'project' ? service.messages('other-session') : service.messages('other-workspace', id), error => error.code === 'NOT_FOUND');
  } finally {
    if (service && id) await service.deleteSession(owner, id);
    f.close();
  }
});

for (const scope of ['project', 'workspace']) test(`${scope} messages/SSE reports only the current root run, including tool loops and incomplete termination`, { timeout: 10000 }, async () => {
  const f = fixture();
  let service, owner, id, lease, disconnect, release, started, scenario, activeEmit, rebuild;
  const emitMessage = (emit, key, role, value, stopReason = 'stop') => emit({ type: 'pi_event', piType: 'message_end', temporaryId: key, payload: { message: { role, usage: value, stopReason } } });
  f.runtime.steer = async () => emitMessage(activeEmit, 'steered-response', 'assistant', usage(1));
  f.runtime.interrupt = async () => release();
  f.runtime.send = async (handle, text, emit) => {
    activeEmit = emit;
    scenario(emit);
    started();
    await new Promise(resolve => { release = resolve; });
    if (text === 'abort' || text === 'failure') {
      const error = new DomainError(text === 'abort' ? 'REQUEST_ABORTED' : 'MODEL_REQUEST_FAILED', text, 409, true);
      error.requestSettled = true;
      throw error;
    }
  };
  try {
    if (scope === 'project') {
      const projects = createProjectRepository(f.db), sessions = createSessionRepository(f.db);
      owner = projects.create({ name: 'P', description: null, kind: 'code', rootPath: f.a, status: 'active' }).id;
      id = sessions.create({ projectId: owner, purpose: '', agentId: null, agentSnapshot: null, mcpIds: [], mcpSnapshots: [] }).id;
      rebuild=()=>createSessionExecutionService({ sessions, projects, catalog: {}, runtime: f.runtime });
      service = rebuild();
      lease = await service.open(id, 'open');
    } else {
      rebuild=()=>createWorkspaceService({ repository: f.repository, runtime: f.runtime, directories: workspaceDirectories });
      service = rebuild();
      owner = (await service.save(null, { name: 'W', projects: [{ rootPath: f.a }], defaultProjectIndex: 0 }, 'create')).id;
      id = service.createSession(owner, {}, 'create').id;
      lease = await service.open(owner, id);
    }
    const frames = [];
    disconnect = service.events.subscribe(id, lease.leaseId, frame => { if (frame.event === 'message') frames.push(frame.data); }, () => {});
    let previousRequest;
    const cases = [
      { text: 'tool loop', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'tool', 'toolResult', usage(1000)); emitMessage(emit, 'b', 'assistant', usage(2)); }, total: 30, complete: true },
      { text: 'next root', steer: true, produce(emit) { emitMessage(emit, 'a', 'assistant', usage(4)); }, total: 50, complete: true },
      { text: 'partial', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'b', 'assistant', undefined); }, total: 10, complete: false },
      { text: 'abort', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(2)); }, total: 20, complete: false },
      { text: 'failure', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(3)); }, total: 30, complete: false },
      { text: 'missing', produce(emit) { emitMessage(emit, 'a', 'assistant', undefined); }, total: null, complete: false },
      { text: 'zero failure placeholder', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(0), 'error'); }, total: null, complete: false },
      { text: 'invalid', produce(emit) { emitMessage(emit, 'a', 'assistant', { ...usage(1), input: -1 }); }, total: null, complete: false },
    ];
    for (const [index, item] of cases.entries()) {
      const from = frames.length;
      const entered = new Promise(resolve => { started = resolve; });
      scenario = item.produce;
      if (scope === 'project') service.accept(id, item.text);
      else await service.accept(owner, id, { content: item.text }, 'message-'+index, lease.leaseId);
      await entered;
      assert.equal(frames.slice(from).filter(f => f.type === 'run_metrics').length, 0, 'no final stats during tool execution');
      if (item.steer) {
        if (scope === 'project') await service.steer(id, 'correction');
        else await service.steer(owner, id, { content: 'correction' }, 'steer-key', lease.leaseId);
      }
      await new Promise(resolve => setTimeout(resolve, 12));
      if(index===0){
        const start=frames.slice(from).find(frame=>frame.type==='run_started').payload;
        disconnect();
        lease=scope==='project'?await service.open(id,'mid-run-reopen'):await service.open(owner,id);
        const restored=[];let restoring=true,ready;
        disconnect=service.events.subscribe(id,lease.leaseId,frame=>{if(frame.event==='ready')ready=frame.data;if(frame.event==='message'){restored.push(frame.data);if(!restoring)frames.push(frame.data);}},()=>{});
        restoring=false;
        const progress=restored.find(frame=>frame.type==='run_progress').payload;
        assert.equal(progress.requestId,start.requestId);assert.equal(progress.startedAt,start.startedAt);
        assert.equal(progress.totalTokens,30);assert(progress.durationMs>=10);assert.equal(progress.complete,false);
        assert.equal(ready.runMetrics.requestId,start.requestId);assert.equal(ready.runMetrics.totalTokens,30);assert(ready.runMetrics.durationMs>=10,'ready restores elapsed time without waiting for progress');
      }
      if (item.text === 'abort') {
        if (scope === 'project') await service.interrupt(id);
        else await service.interrupt(owner, id);
      } else release();
      for (let i=0; i<30 && !frames.slice(from).some(f => f.type === 'run_metrics'); i++) await tick();
      await tick();
      const current = frames.slice(from), starts = current.filter(f => f.type === 'run_started'), summaries = current.filter(f => f.type === 'run_metrics');
      assert.equal(starts.length, 1);
      assert.equal(summaries.length, 1);
      const result = summaries[0].payload;
      assert.equal(result.requestId, starts[0].payload.requestId);
      assert.notEqual(result.requestId, previousRequest);
      previousRequest = result.requestId;
      assert.equal(result.totalTokens, item.total);
      assert.equal(result.complete, item.complete);
      assert(result.durationMs >= 10, 'server duration includes the controlled model/tool wait');
      if(index===0){
        disconnect();
        lease=scope==='project'?await service.open(id,'finished-reopen'):await service.open(owner,id);
        const restored=[];let restoring=true;
        disconnect=service.events.subscribe(id,lease.leaseId,frame=>{if(frame.event==='message'){if(restoring)restored.push(frame.data);else frames.push(frame.data);}},()=>{});
        restoring=false;
        assert.deepEqual(restored.find(frame=>frame.type==='run_metrics').payload,result,'final stats survive reconnect without recounting');
      }
      if (item.total !== null) {
        assert.equal(result.input, item.total/10);
        assert.equal(result.output, item.total/5, 'reasoning is not added twice');
        assert.equal(result.cacheRead, item.total*0.3);
        assert.equal(result.cacheWrite, item.total*0.4);
      } else for (const key of ['input','output','cacheRead','cacheWrite']) assert.equal(result[key], null);
    }
    disconnect();
    service=rebuild();
    const reopened = scope === 'project' ? await service.open(id, 'reopen') : await service.open(owner, id);
    const replay = [];
    disconnect = service.events.subscribe(id, reopened.leaseId, frame => replay.push(frame), () => {});
    await tick();
    assert.equal(replay.filter(frame=>frame.data?.type==='run_started').length,1);
    const restoredFinal=replay.find(frame=>frame.data?.type==='run_metrics').data.payload;
    assert.equal(restoredFinal.requestId,previousRequest);assert.equal(restoredFinal.totalTokens,null);
    assert.deepEqual(replay.find(frame=>frame.event==='ready').data.runMetrics,restoredFinal,'reconstructed event service shares the process snapshot');
    const restoredCount=replay.length;
    if (scope === 'workspace') {
      await service.accept(owner, id, { content: 'next root' }, 'message-1', reopened.leaseId);
      await tick();
      assert(!replay.slice(restoredCount).some(frame => ['run_started','run_metrics'].includes(frame.data?.type)), 'idempotent replay must not create a new run');
    }
  } finally {
    release?.(); disconnect?.();
    if (service && id) await service.deleteSession(owner, id);
    f.close();
  }
});

for (const scope of ['project', 'workspace']) test(`${scope} messages derives latest-run usage from native history and execution boundaries after reconstruction`, async () => {
  const f=fixture();
  const {createProjectOperationStore}=require('../src/infrastructure/projects/operation-journal.server.ts');
  const operations=createProjectOperationStore(f.a);
  let service,owner,id,projects,sessions;
  const node=(id,parentId,role,n)=>({entry:{id,parentId,type:'message',timestamp:new Date().toISOString(),message:{role,...(n===undefined?{}:{usage:usage(n)})}},label:null,labelTimestamp:null});
  let entries=[node('old',null,'assistant',100),node('root','old','user'),node('a','root','assistant',2),node('correction','a','user'),node('b','correction','assistant',3),node('tool','b','toolResult',1000)];
  f.runtime.readTree=async()=>({entries,activeLeafId:entries.at(-1)?.entry.id??null});
  const build=()=>scope==='project'?createSessionExecutionService({sessions,projects,catalog:{},runtime:f.runtime,operations:createProjectOperationStore(f.a)}):createWorkspaceService({repository:f.repository,runtime:f.runtime,directories:workspaceDirectories});
  const read=()=>scope==='project'?service.messages(id):service.messages(owner,id);
  try {
    if(scope==='project'){
      projects=createProjectRepository(f.db);sessions=createSessionRepository(f.db);
      owner=projects.create({name:'P',description:null,kind:'code',rootPath:f.a,status:'active'}).id;
      id=sessions.create({projectId:owner,purpose:'',agentId:null,agentSnapshot:null,mcpIds:[],mcpSnapshots:[]}).id;
    }else{
      const setup=build();owner=(await setup.save(null,{name:'W',projects:[{rootPath:f.a}],defaultProjectIndex:0},'create')).id;id=setup.createSession(owner,{},'create').id;
    }
    service=build();if(scope==='project')await service.open(id,'open');else await service.open(owner,id);
    assert.equal((await read()).latestRunUsage,null,'missing execution boundary must not guess the last user turn');
    const before=['old'],after=entries.map(item=>item.entry.id);
    if(scope==='project'){
      let record=operations.prepare(owner,id,'message','root',{}, {baseline:{entryIds:before}});
      operations.append(record,'completed',{after:{entryIds:after}});
    }else{
      const handle=f.runtime.getHandle(id);
      f.runtime.requestEntry(handle,'workspace_request',{key:'root',hash:'hash',entryIds:before});
      f.runtime.requestEntry(handle,'workspace_request',{key:'steer',hash:'steer',operation:'steer'});
      f.runtime.requestEntry(handle,'workspace_request_result',{key:'root',hash:'hash',outcome:'settled',entryIds:after});
    }
    assert.deepEqual((await read()).latestRunUsage,{totalTokens:50,complete:true},'include tool loops and correction, exclude previous root and tool usage');
    entries.push(node('later','tool','assistant',999));
    service=build();
    assert.deepEqual((await read()).latestRunUsage,{totalTokens:50,complete:true},'cold read derives the same usage within the completed boundary');
    entries=entries.filter(item=>item.entry.id!=='a');
    assert.equal((await read()).latestRunUsage,null,'missing native evidence cannot produce a misleading complete count');
    assert(!require('node:fs').existsSync(require('node:path').join(f.a,'session-run-metrics')),'no statistics store is created');
  }finally{if(service&&id)await service.deleteSession(owner,id);f.close();}
});
