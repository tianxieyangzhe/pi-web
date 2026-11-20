require("./register.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");
const sharp = require("sharp");
const {
  ImageRepository,
} = require("../src/infrastructure/database/image-repository.ts");
const {
  ImageWorkbenchService,
} = require("../src/application/image-workbench-service.ts");
const {
  createImageApi,
} = require("../src/shared/protocol/image-api.server.ts");
const {
  createImageFiles,
} = require("../src/infrastructure/images/files.server.ts");
let createImageProviders;
test.before(async()=>{
  const Module=require('node:module'),pi=await import('@earendil-works/pi-coding-agent'),original=Module._load;
  Module._load=function(name,...args){return name==='@earendil-works/pi-coding-agent'?pi:original.call(this,name,...args);};
  try{({createImageProviders}=require('../src/infrastructure/images/providers.server.ts'));}finally{Module._load=original;}
});
test('image HTTP: route inspection is inert and isolated reloads preserve a current structured planning request',async t=>{
  const f=await fixture(t);
  const vm=require('node:vm'),swc=require('next/dist/build/swc');
  const source=await fs.readFile(path.resolve('src/bootstrap/images.server.ts'),'utf8');
  const code=swc.transformSync(source,{filename:'images.server.ts',jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}}).code;
  const sharedProcess={};
  let starts=0;
  const originalStart=f.service.start.bind(f.service);
  f.service.start=(...args)=>{starts++;return originalStart(...args);};
  const routeSource=await fs.readFile(path.resolve('src/app/api/images/[[...segments]]/route.ts'),'utf8');
  const routeCode=swc.transformSync(routeSource,{filename:'route.ts',jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}}).code;
  const load=(processState={...sharedProcess}, Service=class extends ImageWorkbenchService {constructor(){super();return f.service;}})=>{
    const exports={};
    vm.runInNewContext(code,{exports,process:processState,require(name){
      if(name==='server-only')return {};
      if(name==='node:path')return path;
      if(name.endsWith('application-config-root'))return {applicationConfigRoot:'controlled-root'};
      if(name.endsWith('image-workbench-service'))return {ImageWorkbenchService:Service};
      if(name.endsWith('image-repository'))return {ImageRepository:class{}};
      if(name.endsWith('database.server'))return {database:f.db,imageSchemaCompatible:true};
      if(name.endsWith('files.server'))return {createImageFiles:()=>null};
      if(name.endsWith('image-discussion.server'))return {createImageDiscussion:()=>f.discussion};
      if(name.endsWith('providers.server'))return {createImageProviders:()=>null};
      throw Error('Unexpected dependency '+name);
    }});
    const route={};
    vm.runInNewContext(routeCode,{exports:route,require(name){
      if(name.endsWith('bootstrap/images.server'))return exports;
      if(name.endsWith('image-api.server'))return {createImageApi};
      throw Error('Unexpected route dependency '+name);
    }});
    return route;
  };
  const firstRoute=load();
  assert.equal(starts,0,'importing route/bootstrap cannot initialize or clean a database');
  const context={params:Promise.resolve({segments:['tasks']})};
  assert.equal((await firstRoute.GET(new Request('http://test/api/images/tasks'),context)).status,200);
  assert.equal(starts,1);
  const c=await f.create(),a=await f.task(c.conversation),asset=await f.upload(a.task);
  let release,entered;
  const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  f.setPromptHook(async(command,planning)=>{
    assert.equal(planning.defaultProfileId,'official');
    assert.equal(planning.outputLimits.maxOutputs,32);
    assert.equal(planning.profiles[0].modelId,'gpt-image-1');
    assert.ok(planning.operations.process.includes('零图片模型请求'));
    assert.ok(!JSON.stringify(planning).includes('credentialRef'));
    entered();await gate;
    return {operation:'process',intent:'nine icons',preserve:'original',prompt:'',profileId:null,parameters:{},inputs:[{assetId:asset.id,purpose:'base',position:0}],outputSpec:logoOutput};
  });
  const d=f.service.getDraft(c.conversation.id,a.task.id);
  const saved=await f.call('PATCH',`/conversations/${c.conversation.id}/draft`,{draftId:d.id,text:'nine icons',profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[asset.id]},{revision:d.revision});
  const accepted=await f.call('POST',`/conversations/${c.conversation.id}/messages`,{draftId:d.id,skipConfirmation:false},{revision:saved.data.revision});
  assert.equal(accepted.status,202,JSON.stringify(accepted));
  await started;
  try{
    const before=starts;
    const inspection=load();
    assert.equal(starts,before,'a short-lived route inspection worker must not clean live work');
    assert.equal(f.service.getCommand(accepted.data.id).status,'running');
    assert.equal((await inspection.GET(new Request('http://test/api/images/tasks'),context)).status,200);
    assert.equal(starts,before+1,'an actual request initializes its isolated service');
    assert.equal(f.service.getCommand(accepted.data.id).status,'running');
  }finally{release();}
  for(let i=0;i<100&&f.service.getCommand(accepted.data.id).status==='running';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.service.getCommand(accepted.data.id).status,'completed',JSON.stringify(f.service.getCommand(accepted.data.id)));
  assert.equal(f.service.getTask(a.task.id).currentPlan.outputSpec.targets.length,9);
  assert.equal(f.providerCalls,0);
  const cachedProcess = {};
  class OldService extends ImageWorkbenchService {
    constructor(){super();return f.service;}
    getTask(id){const detail=super.getTask(id);delete detail.referenceAssets;return detail;}
  }
  Object.setPrototypeOf(f.service, OldService.prototype);
  const oldRoute = load(cachedProcess, OldService);
  const taskContext = {params:Promise.resolve({segments:['tasks',a.task.id]})};
  const requestTask = route => route.GET(new Request(`http://test/api/images/tasks/${a.task.id}`),taskContext);
  assert.equal((await (await requestTask(oldRoute)).json()).data.referenceAssets, undefined);
  const startsBeforeReload = starts;
  const currentRoute = load(cachedProcess);
  const refreshed = await (await requestTask(currentRoute)).json();
  assert.equal(starts, startsBeforeReload, 'updating cached methods must preserve live workers');
  assert.deepEqual(refreshed.data.referenceAssets.map(item=>item.id), [asset.id]);
  assert.equal(typeof refreshed.data.referenceAssets[0].createdAt, 'string');
});
const { logoOutput } = require("../src/domain/images.ts");
let next = 0;
async function fixture(
  t,
  {
    providerFail = false,
    discussionFail = false,
    notificationFail = false,
    notificationHook,
    providerFactory,
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-api-"));
  await fs.writeFile(path.join(root,"models.json"),JSON.stringify({providers:{}}));
  await fs.writeFile(path.join(root,"settings.json"),"{}");
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(
    (
      await Promise.all(
        [
          "core-schema.sql",
          "role-schema.sql",
          "workspace-schema.sql",
          "image-schema.sql",
        ].map((name) =>
          fs.readFile(
            path.resolve("src/infrastructure/database", name),
            "utf8",
          ),
        ),
      )
    ).join("\n"),
  );
  const store = new ImageRepository(db);
  const files = createImageFiles(path.join(root, "images"), store);
  const providerRequests = [];
  let providerCalls = 0,
    promptCalls = 0,
    notifyCalls = 0;
  const histories = new Map();
  let promptHook;
  const profile = {
    schemaVersion: 1,
    id: "official",
    provider: "openai",
    adapter: "openai-images-v1",
    modelId: "gpt-image-1",
    capabilityVersion: "v1",
    credentialRef: "openai",
    configHash: "fixed",
    timeoutMs: 60000,
    parameters: [],
    defaults: {},
    limits: { maxInputs: 4, maxGeneratedImages: 1 },
  };
  const providers = {
    async configuration() {
      return {
        profiles: [profile],
        defaultProfileId: "official",
        concurrency: 1,
      };
    },
    async authorize() {},
    parameters(_p, v) {
      return v;
    },
    async generate(_profile, operation, prompt, parameters) {
      providerCalls++;
      providerRequests.push({operation,prompt,parameters});
      if (providerFail)
        throw Object.assign(new Error("timeout"), {
          code: "IMAGE_PROVIDER_UNCERTAIN",
        });
      return {
        images: [
          await sharp({
            create: {
              width: 128,
              height: 64,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
        ],
      };
    },
  };
  const discussion = {
    async create(id) {
      const ref = {
        kind: "pi",
        sessionFile: path.join(root, id + ".jsonl"),
        sessionId: id,
        cwd: path.join(root, "images"),
      };
      histories.set(id, []);
      return ref;
    },
    tree(ref) {
      return {
        entries: histories.get(ref.sessionId) || [],
        activeLeafId: null,
      };
    },
    async recordInput(ref, command, attachments) {
      const snapshot = JSON.parse(command.request_json).draftSnapshot;
      const history = histories.get(ref.sessionId);
      const markerId = `direct-${command.id}`;
      history.push({entry:{id:markerId,type:"custom",customType:"image-command",data:{taskId:snapshot.taskId,commandId:command.id},parentId:history.at(-1)?.entry.id ?? null}});
      history.push({entry:{id:`user-${command.id}`,type:"message",parentId:markerId,message:{role:"user",content:snapshot.text}}});
    },
    async prompt(ref, command, planning, attachments, evidence, changed, signal) {
      promptCalls++;
      const snapshot = JSON.parse(command.request_json).draftSnapshot;
      const markerId = `marker-${promptCalls}`;
      const history = histories.get(ref.sessionId);
      history.push({entry:{id:markerId,type:"custom",customType:"image-command",data:{taskId:snapshot.taskId,commandId:command.id},parentId:history.at(-1)?.entry.id ?? null}});
      const historyId = `entry-${promptCalls}`;
      history.push({entry:{id:historyId,type:"message",parentId:markerId,message:{role:"user",content:snapshot.text}}});
      changed();
      const result = await promptHook?.(command, planning, attachments, signal);
      if (discussionFail)
        throw Object.assign(Error("failed"), {
          code: "IMAGE_DISCUSSION_FAILED",
        });
      return typeof result === "string" ? result : JSON.stringify(result ?? null);
    },
    async notify() {
      notifyCalls++;
      if (notificationHook) await notificationHook();
      if (notificationFail) throw Error("disk");
      return "notification-entry";
    },
  };
  const service = new ImageWorkbenchService(
    store,
    files,
    discussion,
    providerFactory ? providerFactory(root) : providers,
  );
  service.start();
  const api = createImageApi(service);
  t.after(async () => {
    for (
      let i = 0;
      i < 100 &&
      store
        .list("executions")
        .some((e) => ["queued", "running", "processing"].includes(e.status));
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setImmediate(r));
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function call(
    method,
    url,
    body,
    { key = "key-" + ++next, revision, signal } = {},
  ) {
    const headers = {};
    if (method !== "GET") headers["Idempotency-Key"] = key;
    if (revision !== undefined) headers["If-Match"] = String(revision);
    const form = body instanceof FormData;
    if (body !== undefined && !form)
      headers["Content-Type"] = "application/json";
    const request = new Request("http://test/api/images" + url, {
      method,
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      signal,
    });
    const pathname = new URL(request.url).pathname
      .slice("/api/images".length)
      .split("/")
      .filter(Boolean);
    const response = await api(request, pathname);
    if (response.headers.get("Content-Type")?.includes("application/json"))
      return { status: response.status, ...(await response.json()) };
    return response;
  }
  async function create() {
    const c = await call("POST", "/conversations", {});
    assert.equal(c.status, 201, JSON.stringify(c));
    return c.data;
  }
  async function task(conversation, name = "Logo") {
    const c = store.conversation(conversation.id);
    const r = await call(
      "POST",
      `/conversations/${c.id}/tasks`,
      { name },
      { revision: c.revision },
    );
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  }
  async function upload(task) {
    const bytes = await sharp({
      create: { width: 128, height: 64, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new File([bytes], "logo.png", { type: "image/png" }));
    const r = await call("POST", `/tasks/${task.id}/references`, form);
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data.asset;
  }
  async function plan(
    task,
    asset,
    {
      operation = "process",
      outputSpec = logoOutput,
      intent = "website logo",
      key,
    } = {},
  ) {
    const t = store.task(task.id);
    const body = {
      operation,
      intent,
      preserve: "keep original",
      prompt: operation === "process" ? "" : "red logo",
      profileId: operation === "process" ? null : "official",
      parameters: {},
      inputs: asset
        ? [
            {
              assetId: asset.id,
              purpose: operation === "generate" ? "reference" : "base",
              position: 0,
            },
          ]
        : [],
      outputSpec,
    };
    const r = await call("POST", `/tasks/${task.id}/plans`, body, {
      revision: t.revision,
      ...(key ? { key } : {}),
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return { result: r.data, body };
  }
  async function settled(id) {
    for (let i = 0; i < 150; i++) {
      const e = service.getExecution(id);
      if (
        ["failed", "completed"].includes(e.status) &&
        !["pending", "writing"].includes(e.notification.state)
      )
        return e;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Execution did not settle");
  }
  return {
    root,
    db,
    store,
    files,
    discussion,
    service,
    call,
    create,
    task,
    upload,
    plan,
    settled,
    profile,
    providerRequests,
    get providerCalls() {
      return providerCalls;
    },
    get promptCalls() {
      return promptCalls;
    },
    get notifyCalls() {
      return notifyCalls;
    },
    setPromptHook(fn) {
      promptHook = fn;
    },
  };
}
test('image HTTP: ordinary send plans and executes all nine outputs without a second confirmation',async t=>{
  const f=await fixture(t),c=await f.create(),a=await f.task(c.conversation),asset=await f.upload(a.task);
  f.setPromptHook(async(command,planning)=>{
    assert.equal(JSON.parse(command.request_json).draftSnapshot.skipConfirmation,true);
    return {operation:'process',intent:'nine icons',preserve:'original',prompt:'',profileId:null,parameters:{},inputs:[{assetId:asset.id,purpose:'base',position:0}],outputSpec:logoOutput};
  });
  const d=f.service.getDraft(c.conversation.id,a.task.id);
  const saved=await f.call('PATCH',`/conversations/${c.conversation.id}/draft`,{draftId:d.id,text:'nine sizes',profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[asset.id]},{revision:d.revision});
  const accepted=await f.call('POST',`/conversations/${c.conversation.id}/messages`,{draftId:d.id},{revision:saved.data.revision});
  assert.equal(accepted.status,202,JSON.stringify(accepted));
  let cmd;
  for(let i=0;i<100;i++){cmd=f.service.getCommand(accepted.data.id);if(['completed','failed'].includes(cmd.status))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(cmd.status,'completed',JSON.stringify(cmd));
  assert.equal(cmd.autoExecution.state,'admitted');
  const done=await f.settled(cmd.resultIds.executionIds[0]);
  assert.equal(done.status,'completed');
  assert.equal(done.outputResults.length,9);
  assert.ok(done.outputResults.every(o=>o.availability==='ready'));
  assert.equal(f.providerCalls,0);
});
test("image HTTP: independent drafts, optimistic versions and original If-Match replay", async (t) => {
  const f = await fixture(t);
  const c = await f.create();
  const a = await f.task(c.conversation, "A");
  const b = await f.task(c.conversation, "B");
  const body = {
    draftId: a.draft.id,
    text: "A input",
    profileId: null,
    parameters: { schemaVersion: 1, explicitParameters: {} },
    referenceIds: [],
  };
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    body,
    { key: "save", revision: 1 },
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 2);
  const replay = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    body,
    { key: "save", revision: 1 },
  );
  assert.deepEqual(replay, saved);
  const conflict = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    { ...body, text: "overwrite" },
    { revision: 1 },
  );
  assert.equal(conflict.status, 412);
  assert.equal(
    (
      await f.call(
        "GET",
        `/conversations/${c.conversation.id}/draft?taskId=${b.task.id}`,
      )
    ).data.text,
    "",
  );
  assert.equal(
    (await f.call("GET", `/conversations/${c.conversation.id}/draft`)).data
      .text,
    "",
  );
  const c2 = await f.create();
  const wrong = await f.call(
    "PATCH",
    `/conversations/${c2.conversation.id}/draft`,
    body,
    { revision: 2 },
  );
  assert.equal(wrong.status, 404);
});
test("image HTTP: no confirmation means zero calls; exact nine PNG outputs and ordinary confirm cannot repeat", async (t) => {
  const f = await fixture(t, {
    notificationFail: true,
    providerFactory: (root) =>
      createImageProviders(
        root,
        async () => {
          throw Error("process must not request a provider");
        },
        async () => {
          throw Error("process must not request credentials");
        },
      ),
  });
  const capability = await f.call("GET", "/capabilities");
  assert.equal(capability.status, 200);
  assert.deepEqual(capability.data.profiles, []);
  assert.equal(capability.data.processAvailable, true);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const { result } = await f.plan(a.task, asset);
  assert.equal(f.providerCalls, 0);
  assert.equal(f.store.list("executions").length, 0);
  const body = {
    planId: result.plan.id,
    hash: result.plan.hash,
    taskRevision: result.taskRevision,
  };
  const response = await f.call("POST", `/tasks/${a.task.id}/confirm`, body, {
    key: "confirm",
  });
  assert.equal(response.status, 202, JSON.stringify(response));
  const replay = await f.call("POST", `/tasks/${a.task.id}/confirm`, body, {
    key: "confirm",
  });
  assert.deepEqual(replay, response);
  const duplicate = await f.call("POST", `/tasks/${a.task.id}/confirm`, body);
  assert.ok([409].includes(duplicate.status));
  assert.equal(f.store.list("executions").length, 1);
  const execution = await f.settled(response.data.execution.id);
  assert.equal(execution.status, "completed", JSON.stringify(execution));
  assert.equal(execution.notification.state, "failed");
  assert.equal(execution.providerOutcome, "none");
  assert.equal(f.providerCalls, 0);
  assert.equal(execution.outputResults.length, 9);
  const persistedBeforeRestart=f.db.prepare('SELECT execution_json FROM image_tasks WHERE id=?').get(a.task.id).execution_json;
  f.service.start();
  assert.equal(f.db.prepare('SELECT execution_json FROM image_tasks WHERE id=?').get(a.task.id).execution_json,persistedBeforeRestart,'startup leaves a terminal execution and settled notification byte-for-byte unchanged');
  for (const output of execution.outputResults) {
    assert.equal(output.availability, "ready");
    const response = await f.call("GET", `/assets/${output.assetId}/content`);
    assert.equal(response.status, 200);
    const png = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.width, output.expected.width);
    assert.equal(metadata.height, output.expected.height);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.hasAlpha, true);
    const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
    assert.equal(pixels[3], 0, "contain keeps transparent padding");
    assert.equal(
      pixels[
        (Math.floor(output.expected.height / 2) * output.expected.width +
          Math.floor(output.expected.width / 2)) *
          4 +
          3
      ],
      255,
      "the original image remains centered and opaque",
    );
  }
  const zip = await f.call("GET", `/executions/${execution.id}/download`);
  const { unzipSync } = require("fflate");
  assert.deepEqual(
    Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer()))).sort(),
    logoOutput.targets.map((t) => t.name).sort(),
  );
  for (const method of ["DELETE", "POST"])
    assert.equal(
      (await f.call(method, `/executions/${execution.id}/cancel`, {})).status,
      404,
    );
});
test("image HTTP: replacing the current plan drops history, invalidates old confirmations, and rejects history routes", async (t) => {
  const f=await fixture(t),c=await f.create(),a=await f.task(c.conversation),asset=await f.upload(a.task);
  const A=await f.plan(a.task,asset), B=await f.plan(a.task,asset,{intent:'different'});
  assert.equal(f.store.list('plans').length,1);
  assert.equal(f.store.find('plans',{id:A.result.plan.id}),undefined);
  assert.equal((await f.call('POST','/tasks/'+a.task.id+'/current-plan',{planId:A.result.plan.id,hash:A.result.plan.hash},{revision:B.result.taskRevision})).status,404);
  const stale=await f.call('POST','/tasks/'+a.task.id+'/confirm',{planId:A.result.plan.id,hash:A.result.plan.hash,taskRevision:A.result.taskRevision});
  assert.equal(stale.error.code,'PLAN_STALE');
  const current=await f.plan(a.task,asset);
  assert.notEqual(current.result.plan.id,A.result.plan.id);
  assert.equal(current.result.plan.hash,A.result.plan.hash);
  const detail=await f.call('GET','/tasks/'+a.task.id);
  assert.equal('plans' in detail.data,false);
  assert.equal('executions' in detail.data,false);
  assert.equal('version' in detail.data.currentPlan,false);
  assert.equal((await f.call('GET','/tasks/'+a.task.id+'?executionLimit=10')).status,400);
  assert.equal((await f.call('GET','/tasks/'+a.task.id+'?planLimit=10')).status,400);
  const accepted=await f.call('POST','/tasks/'+a.task.id+'/confirm',{planId:current.result.plan.id,hash:current.result.plan.hash,taskRevision:current.result.taskRevision});
  assert.equal(accepted.status,202);
  const done=await f.settled(accepted.data.execution.id);
  const outputs=done.assets.filter(a=>a.role==='output');
  const newer=await f.plan(a.task,asset,{intent:'another current plan'});
  assert.equal(f.store.list('plans').length,1);
  assert.equal(f.store.list('executions').length,0);
  assert.equal((await f.call('GET','/executions/'+done.id)).status,404);
  assert.equal((await f.call('GET','/commands/'+accepted.data.command.id)).status,404);
  assert.equal((await f.call('GET','/assets/'+outputs[0].id+'/content')).status,200);
  assert.notEqual(newer.result.plan.id,current.result.plan.id);
});
test("image HTTP: current task cannot be overwritten during processing or notification, while its draft remains editable", async (t) => {
  let releaseProcessing,releaseNotification,processing=false,notifying=false;
  const processingGate=new Promise(resolve=>releaseProcessing=resolve);
  const notificationGate=new Promise(resolve=>releaseNotification=resolve);
  const f=await fixture(t,{notificationHook:async()=>{notifying=true;await notificationGate;}});
  const c=await f.create(),a=await f.task(c.conversation),asset=await f.upload(a.task);
  const originalProcess=f.files.process;
  f.files.process=async(...args)=>{processing=true;await processingGate;return originalProcess(...args);};
  const A=await f.plan(a.task,asset);
  const accepted=await f.call('POST','/tasks/'+a.task.id+'/confirm',{planId:A.result.plan.id,hash:A.result.plan.hash,taskRevision:A.result.taskRevision});
  assert.equal(accepted.status,202);
  async function waitUntil(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Controlled operation did not start');}
  try {
    await waitUntil(()=>processing);
    const processingBefore=JSON.stringify({execution:f.store.get('executions',accepted.data.execution.id),assets:f.store.list('assets')});
    f.service.start();
    assert.equal(JSON.stringify({execution:f.store.get('executions',accepted.data.execution.id),assets:f.store.list('assets')}),processingBefore,'reinitialization cannot interrupt this process execution or staging files');
    const replacement={...A.body,intent:'replacement'};
    const blocked=await f.call('POST','/tasks/'+a.task.id+'/plans',replacement,{revision:f.store.task(a.task.id).revision});
    assert.equal(blocked.error.code,'IMAGE_TASK_BUSY');
    const d=f.service.getDraft(c.conversation.id,a.task.id);
    const saved=await f.call('PATCH','/conversations/'+c.conversation.id+'/draft',{draftId:d.id,text:'next change',profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[]},{revision:d.revision});
    assert.equal(saved.status,200);
    assert.equal(f.store.task(a.task.id).execution_id,accepted.data.execution.id);
    releaseProcessing();
    await waitUntil(()=>notifying);
    const notifyingBefore=JSON.stringify(f.store.get('executions',accepted.data.execution.id));
    f.service.start();
    assert.equal(JSON.stringify(f.store.get('executions',accepted.data.execution.id)),notifyingBefore,'reinitialization cannot fail this process pending notification');
    const duringNotification=await f.call('POST','/tasks/'+a.task.id+'/plans',replacement,{revision:f.store.task(a.task.id).revision});
    assert.equal(duringNotification.error.code,'IMAGE_TASK_BUSY');
    assert.equal(f.service.getExecution(accepted.data.execution.id).notification.state,'writing');
    const activePage=await f.call('GET','/tasks?filter=active');
    assert.ok(!activePage.data.items.some(t=>t.id===a.task.id),'completed tasks waiting for notification do not appear as running');
    releaseNotification();
    const done=await f.settled(accepted.data.execution.id);
    assert.equal(done.status,'completed');
    const next=await f.call('POST','/tasks/'+a.task.id+'/plans',replacement,{revision:f.store.task(a.task.id).revision});
    assert.equal(next.status,201);
    assert.equal(f.store.list('executions').length,0);
    assert.equal(f.service.getDraft(c.conversation.id,a.task.id).text,'next change');
    assert.equal((await f.call('GET','/executions/'+done.id)).status,404);
    const persisted=f.db.prepare('SELECT plan_json,execution_json,plan_inputs_json FROM image_tasks WHERE id=?').get(a.task.id);
    assert.equal(JSON.parse(persisted.plan_json).id,next.data.plan.id);
    assert.equal(persisted.execution_json,null);
    assert.equal(JSON.parse(persisted.plan_inputs_json).length,1);
  } finally {releaseProcessing();releaseNotification();}
});

test("image HTTP: failed unknown provider is terminal, restart requires explicit intent and creates a single successor", async (t) => {
  const f = await fixture(t, { providerFail: true });
  const c = await f.create(),
    a = await f.task(c.conversation);
  const { result } = await f.plan(a.task, null, { operation: "generate" });
  const accepted = await f.call("POST", `/tasks/${a.task.id}/confirm`, {
    planId: result.plan.id,
    hash: result.plan.hash,
    taskRevision: result.taskRevision,
  });
  assert.equal(accepted.status, 202);
  const failed = await f.settled(accepted.data.execution.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.providerOutcome, "unknown");
  assert.equal(f.providerCalls, 1);
  const body = {
    planHash: result.plan.hash,
    taskRevision: f.store.task(a.task.id).revision,
  };
  const missing = await f.call(
    "POST",
    `/executions/${failed.id}/restart`,
    body,
  );
  assert.equal(missing.error.code, "IMAGE_RESTART_ACK_REQUIRED");
  assert.equal(f.providerCalls, 1);
  const restart = await f.call("POST", `/executions/${failed.id}/restart`, {
    ...body,
    acceptUnknownOutcome: true,
  });
  assert.equal(restart.status, 202);
  const again = await f.call("POST", `/executions/${failed.id}/restart`, {
    ...body,
    acceptUnknownOutcome: true,
  });
  assert.equal(again.data.execution.id, restart.data.execution.id);
  const next = await f.settled(restart.data.execution.id);
  assert.equal(next.status, "failed");
  assert.equal(f.providerCalls, 2);
  assert.equal((await f.call('GET','/executions/'+failed.id)).status,404);
  assert.equal(f.store.list('executions').length,1);
  assert.equal(next.restartOfExecutionId, failed.id);
  const third = await f.call("POST", `/executions/${next.id}/restart`, {
    ...body,
    taskRevision: f.store.task(a.task.id).revision,
    acceptUnknownOutcome: true,
  });
  assert.equal(third.status, 202);
  const terminal = await f.settled(third.data.execution.id);
  assert.equal(terminal.restartOfExecutionId, next.id);
  assert.equal(terminal.status, "failed");
  assert.equal(f.providerCalls, 3);
});
test("image HTTP: single-task confirmation rejects batch and dependencies without writes", async (t) => {
  const f = await fixture(t);
  const tables = f.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'image_%'",
    )
    .all();
  assert.equal(tables.length, 3);
  assert.deepEqual(tables.map(t=>t.name).sort(),['image_assets','image_conversations','image_tasks']);
  for(const table of tables)assert.deepEqual(f.db.prepare('PRAGMA foreign_key_list('+table.name+')').all(),[]);
  assert.ok(!tables.some((t) => t.name === "image_plan_dependencies"));
  const c = await f.create(),
    a = await f.task(c.conversation),
    b = await f.task(c.conversation, "Independent request");
  const asset = await f.upload(a.task);
  const A = await f.plan(a.task, asset),
    B = await f.plan(b.task, await f.upload(b.task));
  const body = {
    planId: A.result.plan.id,
    hash: A.result.plan.hash,
    taskRevision: A.result.taskRevision,
  };
  const old = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/confirm`,
    {
      plans: [
        { id: body.planId, hash: body.hash, taskRevision: body.taskRevision },
      ],
    },
  );
  assert.equal(old.status, 404);
  const batch = await f.call("POST", `/tasks/${a.task.id}/confirm`, {
    plans: [body],
  });
  assert.equal(batch.status, 400);
  const foreign = await f.call("POST", `/tasks/${b.task.id}/confirm`, body);
  assert.equal(foreign.status, 404);
  const stale = await f.call("POST", `/tasks/${a.task.id}/confirm`, {
    ...body,
    hash: "wrong",
  });
  assert.equal(stale.error.code, "PLAN_STALE");
  const invalid = await f.call(
    "POST",
    `/tasks/${a.task.id}/plans`,
    {
      ...A.body,
      outputSpec: {
        ...logoOutput,
        targets: [
          { name: "../bad.png", width: 16, height: 16, sourceIndex: 0 },
        ],
      },
    },
    { revision: A.result.taskRevision },
  );
  assert.equal(invalid.status, 422);
  const dependency = await f.call(
    "POST",
    `/tasks/${a.task.id}/plans`,
    {
      ...A.body,
      dependencies: [
        {
          sourceTaskId: b.task.id,
          sourceExecutionId: null,
          selectedAssetId: null,
          purpose: "base",
        },
      ],
    },
    { revision: A.result.taskRevision },
  );
  assert.equal(dependency.status, 400);
  assert.equal(f.store.list("executions").length, 0);
  assert.equal(f.store.list("assets", { role: "output" }).length, 0);
  assert.equal(f.store.list("tasks").length, 2);
  assert.equal(f.providerCalls, 0);
});
test("image HTTP: failed discussion clears only sent draft; user restart never inherits skip authorization", async (t) => {
  const f = await fixture(t, { discussionFail: true });
  const c = await f.create();
  const body = {
    draftId: c.draft.id,
    text: "original input",
    profileId: null,
    parameters: { schemaVersion: 1, explicitParameters: {} },
    referenceIds: [],
  };
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    body,
    { revision: 1 },
  );
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: c.draft.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 1,
        maxGeneratedImages: 1,
        maxOutputs: 9,
      },
    },
    { key: "send", revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  await new Promise((r) => setTimeout(r, 20));
  const command = f.service.getCommand(accepted.data.id);
  assert.equal(command.status, "failed");
  assert.equal(command.inputSnapshot.text, "original input");
  assert.equal(f.service.getDraft(c.conversation.id, null).text, "");
  const draft = f.service.getDraft(c.conversation.id, null);
  await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    { ...body, text: "new unsent input" },
    { revision: draft.revision },
  );
  const next = await f.call(
    "POST",
    `/commands/${command.id}/restart`,
    {},
    { revision: command.revision },
  );
  assert.equal(next.status, 202);
  await new Promise((r) => setTimeout(r, 20));
  const restarted = f.service.getCommand(next.data.id);
  assert.equal(restarted.inputSnapshot.skipConfirmation, false);
  assert.equal(f.promptCalls, 2);
  assert.equal(f.providerCalls, 0);
  assert.equal(
    f.service.getDraft(c.conversation.id, null).text,
    "new unsent input",
  );
  const replay = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: c.draft.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 1,
        maxGeneratedImages: 1,
        maxOutputs: 9,
      },
    },
    { key: "send", revision: saved.data.revision },
  );
  assert.equal(replay.status,412);
  assert.equal(replay.error.code, "VERSION_CONFLICT");
  assert.equal((await f.call('GET','/commands/'+command.id)).status,404);
  assert.equal(f.promptCalls, 2);
});
test("image HTTP: skip aggregate limits reject all work after Pi prepares more outputs than authorized", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const d = f.service.getDraft(c.conversation.id, a.task.id);
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: d.id,
      text: "logo",
      profileId: null,
      parameters: { schemaVersion: 1, explicitParameters: {} },
      referenceIds: [asset.id],
    },
    { revision: d.revision },
  );
  f.setPromptHook(async () => ({
    operation: "process", intent: "icons", preserve: "all", prompt: "", profileId: null, parameters: {},
    inputs: [{assetId:asset.id,purpose:"base",position:0}], outputSpec: logoOutput,
  }));
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: d.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 0,
        maxGeneratedImages: 0,
        maxOutputs: 1,
      },
    },
    { revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  await new Promise((r) => setTimeout(r, 30));
  const command = f.service.getCommand(accepted.data.id);
  assert.equal(command.status, "completed", JSON.stringify(command));
  assert.equal(command.autoExecution.state, "needs_confirmation");
  assert.equal(command.autoExecution.reason, "AUTO_EXECUTE_LIMIT");
  assert.equal(f.store.list("plans").length, 1);
  assert.equal(f.store.list("executions").length, 0);
  assert.equal(f.providerCalls, 0);
});
test("image HTTP: restart initialization ends old queued work, preserves files, and never dispatches it", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const { result } = await f.plan(a.task, asset);
  const time = new Date().toISOString();
  const command = f.store.insert("commands", {
    id: "old-confirm",
    conversation_id: c.conversation.id,
    kind: "confirm",
    scope_key: "old",
    idempotency_key: "old",
    request_hash: "hash",
    request_json: "{}",
    status: "accepted",
    created_at: time,
  });
  f.store.insert("executions", {
    id: "old-execution",
    task_id: a.task.id,
    plan_id: result.plan.id,
    authorization_command_id: command.id,
    authorization_mode: "confirm",
    revision: 1,
    status: "queued",
    phase: "queued",
    provider_outcome: "none",
    notification_state: "none",
    created_at: time,
  });
  f.service.start(new Date(Date.now()+1).toISOString());
  assert.equal(f.service.getExecution("old-execution").status, "failed");
  assert.equal(
    f.service.getCommand("old-confirm").error.code,
    "PROCESS_INTERRUPTED",
  );
  assert.equal(f.providerCalls, 0);
  assert.equal(
    (await f.call("GET", `/assets/${asset.id}/content`)).status,
    200,
  );
});
test("image HTTP: SSE sends complete snapshots and disconnect only releases transport listeners", async (t) => {
  const f = await fixture(t);
  const c = await f.create();
  const abort = new AbortController();
  const response = await f.call(
    "GET",
    "/events?conversations=" +
      encodeURIComponent(JSON.stringify([c.conversation.id])) +
      "&filter=all",
    undefined,
    { signal: abort.signal },
  );
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /event: snapshot/);
  assert.match(text, /"resource":"tasks"/);
  assert.equal(f.service.changes.listenerCount("change"), 1);
  abort.abort();
  await reader.cancel();
  assert.equal(f.service.changes.listenerCount("change"), 0);
  assert.equal(f.promptCalls, 0);
  assert.equal(f.providerCalls, 0);
  const duplicate = await f.call("GET", "/events?filter=all&filter=active");
  assert.equal(duplicate.status, 400);
  const bad = await f.call("GET", "/events?conversations=bad");
  assert.equal(bad.status, 400);
});
test("image HTTP: SSE isolates a draft read error and cancelling a queued refresh never restarts work", async(t)=>{
  const f=await fixture(t),c=await f.create(),a=await f.task(c.conversation);
  const original=f.service.getDraftSnapshot.bind(f.service);
  f.service.getDraftSnapshot=()=>{throw Object.assign(Error('controlled failure'),{code:'IMAGE_RESOURCE_UNAVAILABLE'});};
  const response=await f.call('GET','/events?conversations='+encodeURIComponent(JSON.stringify([c.conversation.id]))+'&taskId='+a.task.id+'&filter=all');
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  let text='';
  for(let i=0;i<12&&!text.includes('"resource":"task:'+a.task.id+'"');i++){
    const next=await reader.read();
    text+=new TextDecoder().decode(next.value);
  }
  assert.match(text,/event: resource_error/);
  assert.ok(text.includes('"resource":"draft:'+a.task.id+'"'));
  assert.ok(text.includes('"resource":"task:'+a.task.id+'"'),'a failed draft does not suppress the task snapshot');
  f.service.getDraftSnapshot=original;
  f.service.changes.emit('change');
  await reader.cancel();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.service.changes.listenerCount('change'),0);
  assert.equal(f.promptCalls,0);
  assert.equal(f.providerCalls,0);
});

test("image HTTP: official adapters execute generation and edits at fixed endpoints, reject changed configuration and never retry 503", async (t) => {
  const image = await sharp({
    create: { width: 32, height: 16, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const calls = [];
  let mode = "success",
    authenticated = true;
  const f = await fixture(t, {
    providerFactory: (root) =>
      createImageProviders(
        root,
        async (url, options) => {
          calls.push({ url, options });
          if (/^\d{3}$/.test(mode)) return new Response("controlled provider error", { status: Number(mode) });
          return Response.json(
            url.includes("openai")
              ? { data: [{ b64_json: image.toString("base64") }] }
              : {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            inlineData: {
                              mimeType: "image/png",
                              data: image.toString("base64"),
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
          );
        },
        async () => {
          if (!authenticated)
            throw Object.assign(Error("missing"), {
              name: "DomainError",
              code: "IMAGE_PROVIDER_UNAVAILABLE",
              status: 503,
              recoverable: true,
            });
          return "controlled-key";
        },
      ),
  });
  const config={providers:{gpt:{baseUrl:'https://api.openai.com/v1',api:'openai-images-v1',apiKey:'controlled-key',models:[{id:'deployment-image-model-A'}]},gemini:{baseUrl:'https://generativelanguage.googleapis.com/v1beta',api:'google-generate-content-v1',apiKey:'controlled-key',models:[{id:'deployment-image-model-B'}]}}};
  const configFile=path.join(f.root,'models.json');
  await fs.writeFile(configFile,JSON.stringify(config));
  const c = await f.create();
  const spec = { ...logoOutput, targets: [logoOutput.targets[0]] };
  async function prepare(profileId, operation, parameters = {}) {
    const task = await f.task(c.conversation, profileId + " " + operation);
    const asset = operation === "edit" ? await f.upload(task.task) : null;
    const body = {
      operation,
      intent: "red logo",
      preserve: "shape",
      prompt: "red logo",
      profileId: profileId+"/"+config.providers[profileId].models[0].id,
      parameters,
      inputs: asset
        ? [{ assetId: asset.id, purpose: "base", position: 0 }]
        : [],
      outputSpec: spec,
    };
    return {
      task: task.task,
      body,
      response: await f.call("POST", `/tasks/${task.task.id}/plans`, body, {
        revision: task.task.revision,
      }),
    };
  }
  async function confirm(p) {
    return f.call("POST", `/tasks/${p.plan.taskId}/confirm`, {
      planId: p.plan.id,
      hash: p.plan.hash,
      taskRevision: p.taskRevision,
    });
  }
  for (const profileId of ["gpt", "gemini"])
    for (const operation of ["generate", "edit"]) {
      const prepared = await prepare(profileId, operation);
      assert.equal(
        prepared.response.status,
        201,
        JSON.stringify(prepared.response),
      );
      const accepted = await confirm(prepared.response.data);
      assert.equal(accepted.status, 202, JSON.stringify(accepted));
      const done = await f.settled(accepted.data.execution.id);
      assert.equal(done.status, "completed", JSON.stringify(done));
    }
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(
    JSON.parse(calls[0].options.body).model,
    "deployment-image-model-A",
  );
  assert.ok(calls[1].options.body instanceof FormData);
  assert.equal(calls[1].options.body.get("model"), "deployment-image-model-A");
  assert.equal(calls[1].options.body.getAll("image[]").length, 1);
  assert.match(
    calls[2].url,
    /generativelanguage.googleapis.com\/v1beta\/models\/deployment-image-model-B:generateContent$/,
  );
  assert.equal(calls[3].url, calls[2].url);
  assert.deepEqual(
    JSON.parse(calls[3].options.body).generationConfig.responseModalities,
    ["TEXT", "IMAGE"],
  );
  const invalid = await prepare("gpt", "generate", { unsupported: "value" });
  assert.equal(invalid.response.status, 422);
  assert.ok(invalid.response.error.fieldErrors.unsupported);
  const fixed = await prepare("gpt", "generate");
  await fs.writeFile(
    configFile,
    JSON.stringify({
      ...config,
      providers:{...config.providers,gpt:{...config.providers.gpt,baseUrl:"https://changed.example/v1"}},
    }),
  );
  const stale = await confirm(fixed.response.data);
  assert.equal(stale.error.code, "IMAGE_PROVIDER_UNAVAILABLE");
  assert.equal(calls.length, 4);
  await fs.writeFile(configFile, JSON.stringify(config));
  authenticated = false;
  const missing = await prepare("gpt", "generate");
  assert.equal(missing.response.error.code, "IMAGE_PROVIDER_UNAVAILABLE");
  assert.equal(calls.length, 4);
  const capabilities = await f.call("GET", "/capabilities");
  assert.equal(capabilities.data.profiles[0].available, false);
  assert.ok(!JSON.stringify(capabilities).includes("controlled-key"));
  authenticated = true;
  for (const status of [502,503,408,400]) {
    mode=String(status);
    const before=calls.length;
    const retry=await prepare('gpt','generate');
    const accepted=await confirm(retry.response.data);
    assert.equal(accepted.status,202);
    const failed=await f.settled(accepted.data.execution.id);
    assert.equal(failed.status,'failed');
    assert.equal(failed.providerOutcome,status===400?'failure':'unknown');
    assert.equal(failed.error.code,status===400?'IMAGE_PROVIDER_REJECTED':'IMAGE_PROVIDER_UNCERTAIN');
    assert.ok(failed.error.message.includes('HTTP '+status));
    const evidence=JSON.parse(f.store.get('executions',failed.id).provider_evidence_json);
    assert.equal(evidence.observations.at(-1).httpStatus,status);
    assert.equal(calls.length,before+1,'failed HTTP requests are never retried');
  }
  await fs.writeFile(configFile, "{broken");
  assert.equal(
    (await f.call("GET", "/capabilities")).error.code,
    "IMAGE_CONFIG_INVALID",
  );
  await fs.writeFile(
    configFile,
    JSON.stringify({
      ...config,
      providers:{bad:{api:"openai-images-v1",models:[{id:"bad"}]}},
    }),
  );
  assert.equal(
    (await f.call("GET", "/capabilities")).error.code,
    "IMAGE_CONFIG_INVALID",
  );
});
test("image HTTP: shared models.json uses Pi authentication and custom endpoint without exposing server configuration", async (t) => {
  const image=await sharp({create:{width:32,height:32,channels:4,background:'#f00'}}).png().toBuffer();
  const requests=[];
  const f=await fixture(t,{providerFactory:root=>createImageProviders(root,async(url,init)=>{
    requests.push({url,headers:init.headers,body:JSON.parse(init.body)});
    return Response.json({data:[{b64_json:image.toString('base64')}]});
  })});
  await fs.writeFile(path.join(f.root,'models.json'),JSON.stringify({providers:{studio:{api:'openai-images-v1',baseUrl:'https://STUDIO.invalid:443/v1/',apiKey:'temporary-image-key',headers:{'X-Image-Account':'temporary-account'},models:[{id:'custom-image-id',samplingParams:{quality:'low'}}]}}}));
  // This retired file must have no effect, even if malformed.
  await fs.writeFile(path.join(f.root,'image-profiles.json'),'{broken');
  const {loadModelConfiguration}=require('../src/infrastructure/pi/model-config.server.ts');
  const selected=await loadModelConfiguration(f.root);
  assert.equal(selected.models.some(m=>m.provider==='studio'),false);
  assert.equal(selected.imageModels[0].id,'custom-image-id');
  const caps=await f.call('GET','/capabilities');
  assert.equal(caps.status,200,JSON.stringify(caps));
  assert.equal(caps.data.defaultProfileId,'studio/custom-image-id');
  assert.equal(caps.data.profiles[0].available,true);
  const c=await f.create(),a=await f.task(c.conversation);
  const plan=await f.call('POST',`/tasks/${a.task.id}/plans`,{operation:'generate',intent:'logo',preserve:'shape',prompt:'red',profileId:'studio/custom-image-id',parameters:{},inputs:[],outputSpec:{...logoOutput,targets:[logoOutput.targets[0]]}},{key:'shared-plan',revision:1});
  assert.equal(plan.status,201,JSON.stringify(plan));
  assert.equal(plan.data.plan.parameters.quality,'low');
  const accepted=await f.call('POST',`/tasks/${a.task.id}/confirm`,{planId:plan.data.plan.id,hash:plan.data.plan.hash,taskRevision:plan.data.taskRevision},{key:'shared-confirm'});
  assert.equal(accepted.status,202,JSON.stringify(accepted));
  assert.equal((await f.settled(accepted.data.execution.id)).status,'completed');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://studio.invalid/v1/images/generations');
  assert.equal(requests[0].body.model,'custom-image-id');
  assert.equal(requests[0].headers.Authorization,'Bearer temporary-image-key');
  assert.equal(requests[0].headers['X-Image-Account'],'temporary-account');
  for(const value of [caps,plan,accepted])for(const secret of ['studio.invalid','temporary-image-key','temporary-account','credentialRef','baseUrl'])assert.ok(!JSON.stringify(value).includes(secret),secret);
  assert.ok(!JSON.stringify(f.store.list('plans')).includes('temporary-image-key'));
  assert.ok(!JSON.stringify(f.store.list('plans')).includes('temporary-account'));
  await fs.writeFile(path.join(f.root,'models.json'),JSON.stringify({providers:{}}));
  const empty=await f.call('GET','/capabilities');
  assert.deepEqual(empty.data.profiles,[]);
});

test("image HTTP: concurrent plan and confirmation requests converge on one durable result", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  const outputSpec = { ...logoOutput, targets: [logoOutput.targets[0]] };
  const body = {
    operation: "generate",
    intent: "logo",
    preserve: "shape",
    prompt: "red",
    profileId: "official",
    parameters: {},
    inputs: [],
    outputSpec,
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      f.call("POST", `/tasks/${a.task.id}/plans`, body, {
        key: "parallel-plan",
        revision: 1,
      }),
    ),
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(results[0].data.plan.id, results[1].data.plan.id);
  assert.equal(f.store.list("plans").length, 1);
  const p = results[0].data;
  const confirm = {
    planId: p.plan.id,
    hash: p.plan.hash,
    taskRevision: p.taskRevision,
  };
  const accepted = await Promise.all(
    [1, 2].map(() =>
      f.call("POST", `/tasks/${a.task.id}/confirm`, confirm, {
        key: "parallel-confirm",
      }),
    ),
  );
  for (const r of accepted) assert.equal(r.status, 202, JSON.stringify(r));
  assert.equal(accepted[0].data.command.id, accepted[1].data.command.id);
  assert.equal(accepted[0].data.execution.id, accepted[1].data.execution.id);
  assert.equal(f.store.list("executions").length, 1);
  await f.settled(accepted[0].data.execution.id);
  assert.equal(f.providerCalls, 1);
});
test("image HTTP: safe SVG import, external resources and corrupted managed files fail explicitly", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  async function uploadSvg(svg) {
    const form = new FormData();
    form.set("file", new File([svg], "logo.svg", { type: "image/svg+xml" }));
    return f.call("POST", `/tasks/${a.task.id}/references`, form);
  }
  const safe = await uploadSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>',
  );
  assert.equal(safe.status, 201, JSON.stringify(safe));
  assert.equal(safe.data.asset.mimeType, "image/png");
  assert.equal(safe.data.sourceAsset.mimeType, "image/svg+xml");
  assert.equal(safe.data.asset.sourceAssetId, safe.data.sourceAsset.id);
  const originalSvg = await f.call(
    "GET",
    `/assets/${safe.data.sourceAsset.id}/content`,
  );
  assert.equal(
    await originalSvg.text(),
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>',
  );
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><image href="https://example.com/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect style="fill:u&#114;l(https://example.com/a.svg)"/></svg>',
  ]) {
    const rejected = await uploadSvg(svg);
    assert.equal(rejected.status, 422);
  }
  const row = f.store.get("assets", safe.data.asset.id);
  const filename = path.join(f.root, "images", row.relative_path);
  await fs.writeFile(filename, "corrupted");
  const rejected = await f.call("GET", `/assets/${row.id}/content`);
  assert.equal(rejected.error.code, "IMAGE_RESOURCE_UNAVAILABLE");
  assert.equal(f.store.get("assets", row.id).availability, "corrupt");
  assert.equal(await fs.readFile(filename, "utf8"), "corrupted");
  const asset = await f.upload(a.task);
  const current = f.store.get("assets", asset.id);
  const file = path.join(f.root, "images", current.relative_path);
  const target = path.join(f.root, "outside.png");
  await fs.rename(file, target);
  await fs.symlink(target, file);
  const symlink = await f.call("GET", `/assets/${asset.id}/content`);
  assert.equal(symlink.error.code, "IMAGE_RESOURCE_UNAVAILABLE");
});
test("image HTTP: schema gate blocks new image writes without changing old database tables", async (t) => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE legacy(id TEXT PRIMARY KEY)");
  const store = new ImageRepository(db, () => false);
  const service = new ImageWorkbenchService(
    store,
    {},
    {},
    {
      async configuration() {
        return { profiles: [], defaultProfileId: null, concurrency: 1 };
      },
    },
  );
  const api = createImageApi(service);
  const response = await api(
    new Request("http://test/api/images/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "new" },
      body: "{}",
    }),
    ["conversations"],
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SCHEMA_INCOMPATIBLE");
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
    [{ name: "legacy" }],
  );
  db.close();
});
test("image application API: real Pi cold identity, default model changes, no tools, and no error/overflow resend", async (t) => {
  const Module = require("node:module");
  const pi = await import("@earendil-works/pi-coding-agent");
  const ai = await import("@earendil-works/pi-ai");
  const original = Module._load;
  let createImageDiscussion;
  Module._load = function (name, ...args) {
    return name === "@earendil-works/pi-coding-agent"
      ? pi
      : original.call(this, name, ...args);
  };
  try {
    ({
      createImageDiscussion,
    } = require("../src/infrastructure/pi/image-discussion.server.ts"));
  } finally {
    Module._load = original;
  }
  const f = await fixture(t);
  const runtime = await pi.ModelRuntime.create({
    credentials: {
      async read() {},
      async list() {
        return [];
      },
      async modify() {},
      async delete() {},
    },
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerProvider("fake-images-discussion", {
    name: "fake",
    baseUrl: "http://localhost",
    apiKey: "fake",
    api: "openai-completions",
    models: ["first", "second"].map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 1000,
    })),
  });
  let modelId = "first",
    mode = "success",
    calls = 0;
  let streamStarted;
  const sessions = [];
  const configure = async () => ({
    runtime,
    defaults: { provider: "fake-images-discussion", modelId },
    models: runtime.getModels(),
    configuration: { models: "native", settings: "native" },
  });
  const create = async (options) => {
    const result = await pi.createAgentSession(options);
    sessions.push({
      activeTools: result.session.getActiveToolNames(),
      tools: options.tools,
      settings: options.settingsManager.getRetrySettings(),
      customTools: options.customTools,
    });
    result.session.agent.streamFunction = (_model, context, options) => {
      assert.equal(context.tools?.length ?? 0, 0);
      assert.ok(context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("defaultProfileId")));
      calls++;
      const isError = mode !== "success";
      const message = {
        role: "assistant",
        content: isError ? [] : [{ type: "text", text: JSON.stringify({ operation:"generate",intent:"logo",preserve:"",prompt:"logo",profileId:"official",parameters:{},inputs:[],outputSpec:logoOutput }) }],
        api: "openai-completions",
        provider: "fake-images-discussion",
        model: modelId,
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: isError ? "error" : "stop",
        errorMessage:
          mode === "overflow"
            ? "maximum context length exceeded"
            : mode === "error"
              ? "503 service unavailable"
              : undefined,
        timestamp: Date.now(),
      };
      const stream = ai.createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (mode === "stall") {
        options.signal.addEventListener("abort", () => {
          stream.push({type:"error",reason:"aborted",error:{...message,stopReason:"aborted"}});
          stream.end();
        }, {once:true});
        streamStarted();
        return stream;
      }
      if (isError)
        stream.push({ type: "error", reason: "error", error: message });
      else stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    };
    return result;
  };
  const discussion = createImageDiscussion(f.root, configure, create);
  const service = new ImageWorkbenchService(f.store, f.files, discussion, {
    async configuration() {
      return { profiles: [{id:"official", provider:"openai",modelId:"test-image",defaults:{},configHash:"test",limits:{maxInputs:4}}], defaultProfileId: "official", concurrency: 1 };
    },
    async authorize() {},
    parameters(_profile, values) { return values; },
  });
  const api = createImageApi(service);
  async function call(method, segments, body, revision) {
    const headers = {
      "Content-Type": "application/json",
      "Idempotency-Key": "pi-" + ++next,
    };
    if (revision !== undefined) headers["If-Match"] = String(revision);
    const response = await api(
      new Request("http://test/api/images/" + segments.join("/"), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      segments,
    );
    return { status: response.status, ...(await response.json()) };
  }
  const created = await call("POST", ["conversations"], {});
  assert.equal(created.status, 201, JSON.stringify(created));
  const c = created.data.conversation;
  const ref = JSON.parse(f.store.conversation(c.id).native_ref_json);
  assert.equal(discussion.tree(ref).entries.length, 0);
  async function prompt(text, wait = true) {
    const d = service.getDraft(c.id, null);
    const saved = await call(
      "PATCH",
      ["conversations", c.id, "draft"],
      {
        draftId: d.id,
        text,
        profileId: null,
        parameters: { schemaVersion: 1, explicitParameters: {} },
        referenceIds: [],
      },
      d.revision,
    );
    const accepted = await call(
      "POST",
      ["conversations", c.id, "messages"],
      { draftId: d.id, skipConfirmation: false },
      saved.data.revision,
    );
    assert.equal(accepted.status, 202, JSON.stringify(accepted));
    if (!wait) return accepted.data;
    for (let i = 0; i < 100; i++) {
      const command = service.getCommand(accepted.data.id);
      if (["completed", "failed"].includes(command.status)) return command;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Pi discussion did not settle");
  }
  const firstPrompt = await prompt("first input");
  assert.equal(firstPrompt.status, "completed", JSON.stringify(firstPrompt));
  modelId = "second";
  assert.equal((await prompt("second input")).status, "completed");
  const cold = service.tree(c.id);
  assert.equal(
    cold.entries.filter(
      (e) => e.entry.type === "message" && e.entry.message.role === "user",
    ).length,
    2,
  );
  const modelChanges = cold.entries
    .filter((e) => e.entry.type === "model_change")
    .map((e) => e.entry.modelId);
  assert.equal(modelChanges.at(-1), "second");
  assert.equal(
    JSON.parse(f.store.conversation(c.id).native_ref_json).sessionId,
    ref.sessionId,
  );
  mode = "error";
  const failed = await prompt("failing input");
  assert.equal(failed.status, "failed");
  assert.equal(calls, 3);
  mode = "overflow";
  const overflow = await prompt("overflow input");
  assert.equal(overflow.status, "failed");
  assert.equal(
    calls,
    4,
    "overflow recovery must not repeat the failed request",
  );
  assert.deepEqual(sessions[0].tools, []);
  assert.deepEqual(sessions[0].activeTools, []);
  assert.deepEqual(sessions[0].customTools, []);
  assert.equal(sessions[0].settings.enabled, false);
  mode = "stall";
  const streaming = new Promise(resolve => { streamStarted = resolve; });
  const activeCommand = await prompt("interrupt native Pi", false);
  await streaming;
  const nativeStop = await call("POST", ["tasks", activeCommand.inputSnapshot.taskId, "interrupt"], { commandId: activeCommand.id });
  assert.equal(nativeStop.status, 200, JSON.stringify(nativeStop));
  assert.equal(nativeStop.data.task.title, "interrupt native Pi");
  assert.equal(nativeStop.data.task.errorCode, "IMAGE_TASK_INTERRUPTED");
  assert.equal(calls, 5);
  const fileBefore = await fs.readFile(ref.sessionFile, "utf8");
  await fs.writeFile(ref.sessionFile, "broken");
  const unavailable = await call("GET", ["conversations", c.id, "messages"]);
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.error.code, "IMAGE_HISTORY_UNAVAILABLE");
  const unavailableTasks = await call("GET", ["tasks"]);
  assert.equal(unavailableTasks.error.code, "IMAGE_HISTORY_UNAVAILABLE");
  assert.equal(
    JSON.parse(f.store.conversation(c.id).native_ref_json).sessionFile,
    ref.sessionFile,
  );
  await fs.writeFile(ref.sessionFile, fileBefore);
});

test("image HTTP: partial output failure preserves ready files; explicit restart uses new assets and paths", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const { result } = await f.plan(a.task, asset);
  const save = f.files.save;
  let outputs = 0;
  f.files.save = async (row, bytes) => {
    if (row.role === "output" && outputs++ === 2)
      throw Object.assign(Error("disk failure"), {
        code: "IMAGE_STORAGE_FAILED",
      });
    return save(row, bytes);
  };
  const accepted = await f.call("POST", `/tasks/${a.task.id}/confirm`, {
    planId: result.plan.id,
    hash: result.plan.hash,
    taskRevision: result.taskRevision,
  });
  const failed = await f.settled(accepted.data.execution.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.providerOutcome, "none");
  assert.equal(
    failed.outputResults.filter((o) => o.availability === "ready").length,
    2,
  );
  assert.equal(
    failed.outputResults.filter((o) => o.availability === "missing").length,
    7,
  );
  const originalPaths = f.store
    .list("assets", { execution_id: failed.id })
    .map((a) => a.relative_path);
  const ready = failed.assets.filter((a) => a.availability === "ready");
  for (const image of ready)
    assert.equal(
      (await f.call("GET", `/assets/${image.id}/content`)).status,
      200,
    );
  f.files.save = save;
  const restarted = await f.call("POST", `/executions/${failed.id}/restart`, {
    planHash: result.plan.hash,
    taskRevision: f.store.task(a.task.id).revision,
  });
  assert.equal(restarted.status, 202);
  const done = await f.settled(restarted.data.execution.id);
  assert.equal(done.status, "completed");
  assert.equal(done.outputResults.length, 9);
  assert.equal((await f.call('GET','/executions/'+failed.id)).status,404);
  for(const image of ready)assert.equal((await f.call('GET','/assets/'+image.id+'/content')).status,200);
  assert.ok(
    f.store
      .list("assets", { execution_id: done.id })
      .every((a) => !originalPaths.includes(a.relative_path)),
  );
  assert.equal(f.providerCalls, 0);
});
test("image HTTP: rename followed by ready-commit failure leaves sealed missing evidence and never repairs it automatically", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  const update = f.store.update.bind(f.store);
  let fail = true;
  f.store.update = (table, id, patch, revision) => {
    if (fail && table === "assets" && patch.availability === "ready")
      throw Object.assign(Error("commit failed"), {
        code: "IMAGE_STORAGE_FAILED",
        status: 503,
        name: "DomainError",
        recoverable: true,
      });
    return update(table, id, patch, revision);
  };
  const bytes = await sharp({
    create: { width: 32, height: 16, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const form = () => {
    const v = new FormData();
    v.set("file", new File([bytes], "logo.png", { type: "image/png" }));
    return v;
  };
  const rejected = await f.call(
    "POST",
    `/tasks/${a.task.id}/references`,
    form(),
    { key: "failed-save" },
  );
  assert.equal(rejected.status, 503);
  const asset = f.store.list("assets")[0];
  assert.equal(asset.availability, "missing");
  assert.ok(asset.sealed_at);
  assert.equal(asset.sha256.length, 64);
  const filename = path.join(f.root, "images", asset.relative_path);
  assert.deepEqual(await fs.readFile(filename), bytes);
  f.service.start(new Date(Date.now()+1).toISOString());
  assert.equal(f.store.get("assets", asset.id).availability, "missing");
  assert.deepEqual(await fs.readFile(filename), bytes);
  const replay = await f.call(
    "POST",
    `/tasks/${a.task.id}/references`,
    form(),
    { key: "failed-save" },
  );
  assert.equal(replay.error.commandId, rejected.error.commandId);
  assert.equal(f.store.list("assets").length, 1);
  fail = false;
  const fresh = await f.call("POST", `/tasks/${a.task.id}/references`, form());
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.data.asset.id, asset.id);
  assert.deepEqual(await fs.readFile(filename), bytes);
});
test("image HTTP: accepted work completes with zero subscribers after request and SSE disconnect", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  const { result } = await f.plan(a.task, null, {
    operation: "generate",
    outputSpec: { ...logoOutput, targets: [logoOutput.targets[0]] },
  });
  const abort = new AbortController();
  const eventResponse = await f.call(
    "GET",
    "/events?filter=all&conversations=" +
      encodeURIComponent(JSON.stringify([c.conversation.id])),
    undefined,
    { signal: abort.signal },
  );
  const reader = eventResponse.body.getReader();
  await reader.read();
  const accepted = await f.call(
    "POST",
    `/tasks/${a.task.id}/confirm`,
    {
      planId: result.plan.id,
      hash: result.plan.hash,
      taskRevision: result.taskRevision,
    },
    { signal: abort.signal },
  );
  assert.equal(accepted.status, 202);
  abort.abort();
  await reader.cancel();
  assert.equal(f.service.changes.listenerCount("change"), 0);
  const done = await f.settled(accepted.data.execution.id);
  assert.equal(done.status, "completed");
  assert.equal(f.providerCalls, 1);
  assert.equal(f.notifyCalls, 1);
});

test("image HTTP: bounded process skip admits one execution after settled Pi and preserves an explicit output specification", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const d = f.service.getDraft(c.conversation.id, a.task.id);
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: d.id,
      text: "exact icons",
      profileId: null,
      parameters: {
        schemaVersion: 1,
        explicitParameters: {},
        outputSpec: logoOutput,
      },
      referenceIds: [asset.id],
    },
    { revision: d.revision },
  );
  f.setPromptHook(async () => ({
      operation: "process",
      intent: "icons",
      preserve: "all",
      prompt: "",
      profileId: null,
      parameters: {},
      inputs: [{ assetId: asset.id, purpose: "base", position: 0 }],
      outputSpec: logoOutput,
  }));
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: d.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 0,
        maxGeneratedImages: 0,
        maxOutputs: 9,
      },
    },
    { revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  let command;
  for (let i = 0; i < 100; i++) {
    command = f.service.getCommand(accepted.data.id);
    if (command.status === "completed" || command.status === "failed") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(command.status, "completed", JSON.stringify(command));
  assert.equal(command.autoExecution.state, "admitted");
  assert.equal(command.resultIds.executionIds.length, 1);
  assert.equal(f.store.list("plans").length, 1);
  const execution = await f.settled(command.resultIds.executionIds[0]);
  assert.equal(execution.status, "completed");
  assert.equal(execution.authorizationMode, "skip_once");
  assert.equal(f.providerCalls, 0);
  assert.equal(f.promptCalls, 1);
  assert.equal(f.notifyCalls, 1);
});
test("image HTTP: identical plan content with a new key returns 200, and invalid JSON preserves the current plan without execution", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation),
    asset = await f.upload(a.task);
  const first = await f.plan(a.task, asset);
  const replay = await f.call("POST", `/tasks/${a.task.id}/plans`, first.body, {
    revision: first.result.taskRevision,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.plan.id, first.result.plan.id);
  assert.equal(replay.data.taskRevision, first.result.taskRevision);
  assert.equal(f.store.list("plans").length, 1);
  const draft = f.service.getDraft(c.conversation.id, null);
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: draft.id,
      text: "explain image workflow",
      profileId: null,
      parameters: { schemaVersion: 1, explicitParameters: {} },
      referenceIds: [],
    },
    { revision: draft.revision },
  );
  f.setPromptHook(async () => "invalid planning response");
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: draft.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 1,
        maxGeneratedImages: 1,
        maxOutputs: 1,
      },
    },
    { revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  await new Promise((r) => setTimeout(r, 20));
  const command = f.service.getCommand(accepted.data.id);
  assert.equal(command.status, "failed");
  assert.equal(command.error.code, "IMAGE_PLAN_INVALID");
  assert.equal(f.service.getTask(a.task.id).currentPlan.id, first.result.plan.id);
  assert.equal(f.store.list("executions").length, 0);
  assert.equal(f.providerCalls, 0);
});

test("image HTTP: explicit import lists safe unregistered candidates with pagination and replays without re-reading a changed source", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  await f.upload(a.task);
  const taskRoot = path.join(f.root, "images", a.task.id);
  const bytes = await sharp({
    create: { width: 24, height: 12, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  await fs.mkdir(path.join(taskRoot, "manual"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, "staging"), { recursive: true });
  for (const name of ["a.png", "b.png", "c.png"])
    await fs.writeFile(path.join(taskRoot, "manual", name), bytes);
  await fs.writeFile(path.join(taskRoot, "staging", "residual.png"), bytes);
  const outside = path.join(f.root, "outside.png");
  await fs.writeFile(outside, bytes);
  await fs.symlink(outside, path.join(taskRoot, "linked.png"));
  const found = [];
  let cursor = null;
  do {
    const page = await f.call(
      "GET",
      `/tasks/${a.task.id}/import-candidates?limit=1${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    assert.equal(page.status, 200, JSON.stringify(page));
    found.push(...page.data.items);
    cursor = page.data.nextCursor;
  } while (cursor);
  assert.equal(found.length, 3);
  assert.deepEqual(
    found.map((a) => a.name),
    ["manual/a.png", "manual/b.png", "manual/c.png"],
  );
  assert.equal(f.store.list("assets").length, 1);
  const candidate = found[0];
  const body = {
    candidateId: candidate.candidateId,
    expectedSha256: candidate.sha256,
  };
  const imported = await f.call("POST", `/tasks/${a.task.id}/import`, body, {
    key: "import-once",
  });
  assert.equal(imported.status, 201, JSON.stringify(imported));
  assert.equal(imported.data.asset.name, "a.png");
  const source = path.join(taskRoot, "manual", "a.png");
  await fs.writeFile(source, "changed");
  const replay = await f.call("POST", `/tasks/${a.task.id}/import`, body, {
    key: "import-once",
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.data.asset.id, imported.data.asset.id);
  const unchanged = await f.call(
    "GET",
    `/assets/${imported.data.asset.id}/content`,
  );
  assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()), bytes);
  const changed = await f.call("POST", `/tasks/${a.task.id}/import`, body);
  assert.equal(changed.error.code, "IMAGE_RESOURCE_CHANGED");
  assert.equal(f.store.list("assets", { availability: "missing" }).length, 1);
  assert.equal(await fs.readFile(source, "utf8"), "changed");
  assert.deepEqual(await fs.readFile(outside), bytes);
  assert.equal(f.providerCalls, 0);
});

test("image HTTP: multiple fixed base images map by sourceIndex and output key for WebP delivery", async (t) => {
  const f = await fixture(t);
  const c = await f.create(),
    a = await f.task(c.conversation);
  const red = await f.upload(a.task);
  const blueBytes = await sharp({
    create: { width: 24, height: 48, channels: 4, background: "blue" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("file", new File([blueBytes], "blue.png", { type: "image/png" }));
  const uploaded = await f.call("POST", `/tasks/${a.task.id}/references`, form);
  assert.equal(uploaded.status, 201);
  const blue = uploaded.data.asset;
  const outputSpec = {
    schemaVersion: 1,
    format: "webp",
    fit: "cover",
    background: "#FFFFFF",
    quality: 95,
    resample: "lanczos3",
    targets: [
      { name: "second.webp", width: 20, height: 12, sourceIndex: 1 },
      { name: "first.webp", width: 12, height: 20, sourceIndex: 0 },
    ],
  };
  const plan = await f.call(
    "POST",
    `/tasks/${a.task.id}/plans`,
    {
      operation: "process",
      intent: "two originals",
      preserve: "colors",
      prompt: "",
      profileId: null,
      parameters: {},
      inputs: [
        { assetId: red.id, purpose: "base", position: 0 },
        { assetId: blue.id, purpose: "base", position: 1 },
      ],
      outputSpec,
    },
    { revision: f.store.task(a.task.id).revision },
  );
  assert.equal(plan.status, 201, JSON.stringify(plan));
  assert.deepEqual(
    plan.data.plan.inputs.map((i) => i.assetId),
    [red.id, blue.id],
  );
  const accepted = await f.call("POST", `/tasks/${a.task.id}/confirm`, {
    planId: plan.data.plan.id,
    hash: plan.data.plan.hash,
    taskRevision: plan.data.taskRevision,
  });
  assert.equal(accepted.status, 202);
  const done = await f.settled(accepted.data.execution.id);
  assert.equal(done.status, "completed");
  for (const output of done.outputResults) {
    const response = await f.call("GET", `/assets/${output.assetId}/content`);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    const image = sharp(Buffer.from(await response.arrayBuffer()));
    const meta = await image.metadata();
    assert.equal(meta.width, output.expected.width);
    assert.equal(meta.height, output.expected.height);
    const pixels = await image.removeAlpha().raw().toBuffer();
    if (output.outputKey === "second.webp") {
      assert.ok(pixels[2] > 200 && pixels[0] < 50);
    } else {
      assert.ok(pixels[0] > 200 && pixels[2] < 50);
    }
  }
  assert.equal(f.providerCalls, 0);
});

test("image HTTP: Pi keeps one task for a multi-image request and skip admits only its current complete plan", async (t) => {
  const f = await fixture(t),
    c = await f.create();
  let taskId;
  f.setPromptHook(async command => {
    taskId = JSON.parse(command.request_json).draftSnapshot.taskId;
    return {
      operation:"generate", intent:"two pictures", preserve:"colors", prompt:"red logo", profileId:"official", parameters:{}, inputs:[],
      outputSpec:{ ...logoOutput, targets:logoOutput.targets.slice(0,2) },
    };
  });
  const draft = c.draft;
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: draft.id,
      text: "two images in one request",
      profileId: null,
      parameters: { schemaVersion: 1, explicitParameters: {} },
      referenceIds: [],
    },
    { revision: draft.revision },
  );
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: draft.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 1,
        maxGeneratedImages: 1,
        maxOutputs: 2,
      },
    },
    { revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  let command;
  for (let i = 0; i < 100; i++) {
    command = f.service.getCommand(accepted.data.id);
    if (["completed", "failed"].includes(command.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(command.status, "completed", JSON.stringify(command));
  assert.equal(command.autoExecution.state, "admitted");
  assert.equal(f.store.list("tasks").length, 1);
  assert.equal(f.store.list("plans").length, 1);
  assert.equal(command.resultIds.executionIds.length, 1);
  const done = await f.settled(command.resultIds.executionIds[0]);
  assert.equal(done.status, "completed");
  assert.equal(done.taskId, taskId);
  assert.equal(done.outputResults.length, 2);
  assert.equal(f.providerCalls, 1);
  const d = f.service.getDraft(c.conversation.id, taskId);
  const ready = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: d.id,
      text: "continue with the same request",
      profileId: null,
      parameters: { schemaVersion: 1, explicitParameters: {} },
      referenceIds: [],
    },
    { revision: d.revision },
  );
  const independent = await f.task(
    c.conversation,
    "Explicit independent user request",
  );
  f.setPromptHook(async command => {
    assert.equal(JSON.parse(command.request_json).draftSnapshot.taskId, taskId);
    return {
      taskId: independent.task.id,
      operation:"generate", intent:"foreign", preserve:"", prompt:"red", profileId:"official", parameters:{}, inputs:[],
      outputSpec:{ ...logoOutput, targets:logoOutput.targets.slice(0,1) },
    };
  });
  const continuation = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    { draftId: d.id, skipConfirmation: false },
    { revision: ready.data.revision },
  );
  assert.equal(continuation.status, 202);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.service.getCommand(continuation.data.id).error.code, "IMAGE_PLAN_INVALID");
  assert.equal(f.store.list("tasks").length, 2);
  assert.equal(
    f.store.list("plans", { task_id: independent.task.id }).length,
    0,
  );
  assert.equal(f.store.list("executions").length, 1);
});
test("image HTTP: one official request generates multiple distinct images in one task with fixed source mapping", async (t) => {
  const colors = ["red", "blue", "green"];
  const images = await Promise.all(
    colors.map((background) =>
      sharp({ create: { width: 32, height: 32, channels: 4, background } })
        .png()
        .toBuffer(),
    ),
  );
  let requests = 0,
    requestedN;
  const f = await fixture(t, {
    providerFactory: (root) =>
      createImageProviders(
        root,
        async (url, options) => {
          requests++;
          requestedN = JSON.parse(options.body).n;
          return Response.json({
            data: images.map((image) => ({
              b64_json: image.toString("base64"),
            })),
          });
        },
        async () => "controlled-key",
      ),
  });
  await fs.writeFile(path.join(f.root,'models.json'),JSON.stringify({providers:{openai:{baseUrl:'https://api.openai.com/v1',api:'openai-images-v1',apiKey:'controlled-key',models:[{id:'gpt-image-1'}]}}}));
  const c = await f.create(),
    a = await f.task(c.conversation, "Three image set");
  const plan = await f.call(
    "POST",
    `/tasks/${a.task.id}/plans`,
    {
      operation: "generate",
      intent: "three images",
      preserve: "colors",
      prompt: "red blue green",
      profileId: "openai/gpt-image-1",
      parameters: { n: 3 },
      inputs: [],
      outputSpec: {
        ...logoOutput,
        targets: colors.map((color, sourceIndex) => ({
          name: color + ".png",
          width: 16,
          height: 16,
          sourceIndex,
        })),
      },
    },
    { revision: a.task.revision },
  );
  assert.equal(plan.status, 201, JSON.stringify(plan));
  assert.equal(requests, 0);
  const body = {
    planId: plan.data.plan.id,
    hash: plan.data.plan.hash,
    taskRevision: plan.data.taskRevision,
  };
  const accepted = await f.call("POST", `/tasks/${a.task.id}/confirm`, body, {
    key: "three-images",
  });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  const replay = await f.call("POST", `/tasks/${a.task.id}/confirm`, body, {
    key: "three-images",
  });
  assert.equal(replay.data.execution.id, accepted.data.execution.id);
  const done = await f.settled(accepted.data.execution.id);
  assert.equal(done.status, "completed", JSON.stringify(done));
  assert.equal(f.store.list("tasks").length, 1);
  assert.equal(f.store.list("executions").length, 1);
  assert.equal(
    done.assets.filter((a) => a.role === "provider_response").length,
    3,
  );
  assert.equal(done.outputResults.length, 3);
  assert.equal(requests, 1);
  assert.equal(requestedN, 3);
  for (const output of done.outputResults) {
    const response = await f.call("GET", `/assets/${output.assetId}/content`);
    const pixel = await sharp(Buffer.from(await response.arrayBuffer()))
      .removeAlpha()
      .raw()
      .toBuffer();
    const channel = { red: 0, green: 1, blue: 2 }[
      output.outputKey.split(".")[0]
    ];
    assert.ok(pixel[channel] > 100);
    for (let i = 0; i < 3; i++) if (i !== channel) assert.equal(pixel[i], 0);
  }
});
test("image HTTP: restarting a failed overview discussion keeps its original task and never inherits skip", async (t) => {
  const f = await fixture(t, { discussionFail: true }),
    c = await f.create();
  const taskIds = [];
  f.setPromptHook(async command => {
    taskIds.push(JSON.parse(command.request_json).draftSnapshot.taskId);
  });
  const saved = await f.call(
    "PATCH",
    `/conversations/${c.conversation.id}/draft`,
    {
      draftId: c.draft.id,
      text: "three images",
      profileId: null,
      parameters: { schemaVersion: 1, explicitParameters: {} },
      referenceIds: [],
    },
    { revision: c.draft.revision },
  );
  const accepted = await f.call(
    "POST",
    `/conversations/${c.conversation.id}/messages`,
    {
      draftId: c.draft.id,
      skipConfirmation: true,
      autoExecuteLimits: {
        maxImageRequests: 1,
        maxGeneratedImages: 3,
        maxOutputs: 3,
      },
    },
    { revision: saved.data.revision },
  );
  assert.equal(accepted.status, 202);
  await new Promise((r) => setTimeout(r, 25));
  const failed = f.service.getCommand(accepted.data.id);
  assert.equal(failed.status, "failed");
  const restarted = await f.call(
    "POST",
    `/commands/${failed.id}/restart`,
    {},
    { revision: failed.revision },
  );
  assert.equal(restarted.status, 202);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(f.service.getCommand(restarted.data.id).status, "failed");
  assert.equal(
    f.service.getCommand(restarted.data.id).inputSnapshot.skipConfirmation,
    false,
  );
  assert.equal(taskIds.length, 2);
  assert.equal(taskIds[0], taskIds[1]);
  assert.equal(f.store.list("tasks").length, 1);
  assert.equal(f.store.list("executions").length, 0);
  assert.equal(f.providerCalls, 0);
});

test("image HTTP: overview messages reuse the fixed task; ambiguous independent history preserves input and creates no work", async (t) => {
  const f = await fixture(t),
    c = await f.create();
  async function send(text) {
    const d = f.service.getDraft(c.conversation.id, null);
    const saved = await f.call(
      "PATCH",
      `/conversations/${c.conversation.id}/draft`,
      {
        draftId: d.id,
        text,
        profileId: null,
        parameters: { schemaVersion: 1, explicitParameters: {} },
        referenceIds: [],
      },
      { revision: d.revision },
    );
    return {
      saved,
      response: await f.call(
        "POST",
        `/conversations/${c.conversation.id}/messages`,
        { draftId: d.id, skipConfirmation: false },
        { revision: saved.data.revision, key: text },
      ),
    };
  }
  const first = await send("first request");
  assert.equal(first.response.status, 202);
  await new Promise((r) => setTimeout(r, 20));
  const original = f.service.getCommand(first.response.data.id).inputSnapshot
    .taskId;
  assert.ok(original);
  assert.equal(f.store.list("tasks").length, 1);
  assert.equal(f.store.list("commands", { kind: "create_task" }).length, 0);
  const second = await send("continue request");
  assert.equal(second.response.status, 202);
  assert.equal((await f.call('GET','/commands/'+first.response.data.id)).status,404);
  const conversationState=(await f.call('GET','/conversations/'+c.conversation.id)).data.conversation;
  assert.equal(conversationState.latestCommand.id,second.response.data.id);
  assert.equal('commands' in conversationState,false);
  assert.equal(f.store.list('commands',{kind:'message'}).length,1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    f.service.getCommand(second.response.data.id).inputSnapshot.taskId,
    original,
  );
  assert.equal(f.store.list("tasks").length, 1);
  await f.task(c.conversation, "User-created independent request");
  const commands = f.store.list("commands").length;
  const blocked = await send("ambiguous overview input");
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.response.error.code, "IMAGE_TASK_REQUIRED");
  assert.equal(
    f.service.getDraft(c.conversation.id, null).text,
    "ambiguous overview input",
  );
  assert.equal(
    f.store.list("commands").length,
    commands,
    "explicit draft save replaced its current receipt; no history was appended",
  );
  assert.equal(f.store.list("tasks").length, 2);
  assert.equal(f.promptCalls, 2);
  assert.equal(f.providerCalls, 0);
});

async function commandSettled(f, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await f.call("GET", `/commands/${id}`);
    assert.equal(response.status, 200);
    if (["completed", "failed"].includes(response.data.status)) return response.data;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error("Planning never reached a terminal state");
}

function firstSubmission(payload, files = []) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const file of files) form.append("files", file);
  return form;
}

test("image HTTP: first multipart submit validates before writes, converges on one task, and replays its accepted identity", async t => {
  const f = await fixture(t);
  assert.equal((await f.call("GET", "/tasks")).status, 200);
  assert.equal((await f.call("GET", "/conversations")).status, 404);
  const invalid = await f.call("POST", "/conversations/submit", firstSubmission({text:"  "}));
  assert.equal(invalid.status, 400);
  const badFile = new File(["not an image"], "bad.txt");
  assert.equal((await f.call("POST", "/conversations/submit", firstSubmission({text:"logo"}, [badFile]))).status, 415);
  const unavailable = await f.call("POST", "/conversations/submit", firstSubmission({text:"logo",profileId:"absent"}));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(f.store.list("conversations"), []);
  assert.deepEqual(f.store.list("tasks"), []);
  assert.deepEqual(f.store.list("assets"), []);
  assert.equal(f.promptCalls, 0);

  const png = await sharp({create:{width:20,height:20,channels:4,background:"red"}}).png().toBuffer();
  const file = new File([png], "logo.png", { type: "image/png" });
  const payload = {text:"first user text",parameters:{schemaVersion:1,operation:"process",explicitParameters:{},outputSpec:logoOutput}};
  f.setPromptHook(async (_command, planning, attachments) => {
    assert.deepEqual(Buffer.from(attachments[0].bytes), png);
    const assetId = planning.references[0].assetId;
    return {operation:"process",intent:"icons",preserve:"all",prompt:"",profileId:null,parameters:{},
      inputs:[{assetId,purpose:"base",position:0}],outputSpec:logoOutput};
  });
  const send = () => f.call("POST", "/conversations/submit", firstSubmission(payload,[file]), {key:"first-image"});
  const [first, duplicate] = await Promise.all([send(),send()]);
  assert.equal(first.status, 202, JSON.stringify(first));
  assert.equal(duplicate.status, 202, JSON.stringify(duplicate));
  assert.equal(duplicate.data.taskId, first.data.taskId);
  assert.equal(duplicate.data.command.id, first.data.command.id);
  const final = await commandSettled(f, first.data.command.id);
  assert.equal(final.status, "completed", JSON.stringify(final));
  const execution = await f.settled(final.resultIds.executionIds[0]);
  assert.equal(execution.outputResults.filter(item => item.availability === "ready").length, 9);
  assert.equal(f.providerCalls, 0);
  assert.equal(f.promptCalls, 1);
  assert.equal(f.store.list("conversations").length, 1);
  assert.equal(f.store.list("tasks").length, 1);
  assert.equal((await send()).data.command.id, first.data.command.id);
  assert.equal((await f.call("POST","/conversations/submit",firstSubmission({...payload,text:"different"},[file]),{key:"first-image"})).error.code,"IDEMPOTENCY_CONFLICT");
  const taskDetail = (await f.call("GET", `/tasks/${first.data.taskId}`)).data;
  const { task } = taskDetail;
  assert.equal(task.title,"first user text");
  const [reference] = taskDetail.referenceAssets;
  assert.deepEqual(taskDetail.referenceAssets.map(asset => asset.id), final.inputSnapshot.referenceIds);
  assert.equal(reference.availability, "ready");
  const preview = await f.call("GET", reference.previewUrl.replace("/api/images", ""));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  const params = new URLSearchParams({conversations:JSON.stringify([first.data.conversationId]),taskId:task.id});
  const events = await f.call("GET",`/events?${params}`);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let taskListFrame, taskDetailFrame;
  try {
    for (let i=0;i<6 && (!taskListFrame || !taskDetailFrame);i++) {
      const chunk = await reader.read();
      for (const line of decoder.decode(chunk.value).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const {resource,data} = JSON.parse(line.slice(6));
        if (resource === "tasks") taskListFrame = data.items[0];
        if (resource === `task:${task.id}`) taskDetailFrame = data;
      }
    }
    assert.equal(taskListFrame.title,task.title);
    assert.equal(taskDetailFrame.task.createdAt,task.createdAt);
    assert.equal(taskListFrame.derivedStage,taskDetailFrame.task.derivedStage);
    assert.deepEqual(taskDetailFrame.referenceAssets, taskDetail.referenceAssets);
  } finally { await reader.cancel(); }
  const second = await f.task({id:first.data.conversationId},"different task");
  const list = (await f.call("GET","/tasks?limit=1")).data;
  assert.equal(list.items[0].id,second.task.id);
  assert.equal(list.items[0].title,null);
  assert.equal((await f.call("GET",`/tasks?cursor=${list.nextCursor}`)).data.items[0].id,task.id);

  const draftPath = `/conversations/${first.data.conversationId}/draft`;
  let draft = (await f.call("GET",`${draftPath}?taskId=${task.id}`)).data;
  draft = (await f.call("PATCH",draftPath,{draftId:draft.id,text:"  ",profileId:null,parameters:payload.parameters,referenceIds:final.inputSnapshot.referenceIds},{revision:draft.revision})).data;
  const imageOnly = await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:draft.id,skipConfirmation:false},{revision:draft.revision});
  await commandSettled(f, imageOnly.data.id);
  const same = (await f.call("GET",`/tasks/${task.id}`)).data.task;
  assert.equal(same.title,task.title);
  assert.equal(same.createdAt,task.createdAt);
  const afterReplacement = await send();
  assert.equal(afterReplacement.status,202);
  assert.equal(afterReplacement.data.command.id,first.data.command.id);

  const sharedDraft = await f.call("PATCH", draftPath, {
    draftId: second.draft.id, text: "reuse logo", profileId: null, parameters: payload.parameters, referenceIds: [reference.id],
  }, { revision: second.draft.revision });
  assert.equal(sharedDraft.status, 404, JSON.stringify(sharedDraft));
  const otherDetail = (await f.call("GET", `/tasks/${second.task.id}`)).data;
  assert.equal(otherDetail.assets.some(asset => asset.id === reference.id), false);
  assert.deepEqual(otherDetail.referenceAssets, []);
  assert.deepEqual((await f.call("GET", `/tasks/${task.id}`)).data.referenceAssets, [reference]);
  const additional = new FormData();
  additional.append("file", new File([png], "later.png", { type: "image/png" }));
  const uploaded = await f.call("POST", `/tasks/${task.id}/references`, additional);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
  const ordered = (await f.call("GET", `/tasks/${task.id}`)).data.referenceAssets;
  assert.equal(ordered.length, 2);
  assert.deepEqual(new Set(ordered.map(asset => asset.name)), new Set(["logo.png", "later.png"]));
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
});

test("image HTTP: generate entry bypasses LLM and executes raw prompt with defaults, then processes current references", async t => {
  const f = await fixture(t);
  f.setPromptHook(async () => { throw Error("Direct generation must not call LLM"); });
  const {createImageDiscussion}=require("../src/infrastructure/pi/image-discussion.server.ts");
  let agentSessions=0;
  f.service.refreshDiscussion(createImageDiscussion(f.root, async()=>{throw Error("No chat model configured");}, async()=>{agentSessions++;throw Error("Direct entry cannot create AgentSession");}));
  const payload = {text:"  raw logo prompt\n保留原文  ",mode:"generate",profileId:"official",parameters:{schemaVersion:1,explicitParameters:{}}};
  const sendFirst = () => f.call("POST","/conversations/submit",firstSubmission(payload),{key:"direct-first"});
  const [first,duplicate] = await Promise.all([sendFirst(),sendFirst()]);
  assert.equal(first.status,202,JSON.stringify(first));
  assert.equal(duplicate.data.command.id,first.data.command.id);
  const command = await commandSettled(f,first.data.command.id);
  assert.equal(command.status,"completed",JSON.stringify(command));
  assert.equal(command.autoExecution.state,"admitted");
  const result=await f.settled(command.resultIds.executionIds[0]);
  assert.equal(result.status,"completed",JSON.stringify(result));
  const detail=(await f.call("GET",`/tasks/${first.data.taskId}`)).data;
  assert.equal(detail.currentPlan.prompt,payload.text);
  assert.equal(f.providerRequests[0].prompt,payload.text);
  assert.deepEqual(f.providerRequests[0].parameters,{});
  assert.equal(detail.currentPlan.outputSpec.targets[0].width,1024);
  assert.equal(detail.currentPlan.outputSpec.targets[0].height,1024);
  assert.equal(detail.currentPlan.outputSpec.format,"png");
  assert.equal(detail.task.title,payload.text);
  const native = (await f.call("GET",`/conversations/${first.data.conversationId}/messages`)).data;
  assert.ok(native.entries.some(({entry})=>entry.type==="message" && entry.message?.role==="user"));
  assert.equal(agentSessions,0);
  assert.equal(f.promptCalls,0);
  assert.equal(f.providerCalls,1);
  assert.equal((await sendFirst()).data.command.id,first.data.command.id);
  const conflict=await f.call("POST","/conversations/submit",firstSubmission({...payload,mode:"discuss"}),{key:"direct-first"});
  assert.equal(conflict.error.code,"IDEMPOTENCY_CONFLICT");
  const p=`/conversations/${first.data.conversationId}/draft`;
  const draft=(await f.call("GET",`${p}?taskId=${first.data.taskId}`)).data;
  const saved=await f.call("PATCH",p,{draftId:draft.id,text:"九尺寸",profileId:null,parameters:{schemaVersion:1,operation:"process",explicitParameters:{},outputSpec:logoOutput},referenceIds:[detail.images[0].versions[0].id]},{revision:draft.revision});
  const incompatible=await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:draft.id,mode:"generate",skipConfirmation:false},{revision:saved.data.revision});
  assert.equal(incompatible.error.code,"INVALID_INPUT");
  const next=await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:draft.id,mode:"generate"},{revision:saved.data.revision,key:"direct-next"});
  assert.equal(next.status,202,JSON.stringify(next));
  const processed=await commandSettled(f,next.data.id);
  assert.equal(processed.status,"completed",JSON.stringify(processed));
  const outputs=await f.settled(processed.resultIds.executionIds[0]);
  assert.equal(outputs.outputResults.filter(asset=>asset.availability==="ready").length,9);
  assert.equal(f.promptCalls,0);
  assert.equal(f.providerCalls,1);
  const againDraft=(await f.call("GET",`${p}?taskId=${first.data.taskId}`)).data;
  const againSaved=await f.call("PATCH",p,{draftId:againDraft.id,text:"九尺寸",profileId:null,parameters:{schemaVersion:1,operation:"process",explicitParameters:{},outputSpec:logoOutput},referenceIds:[detail.images[0].versions[0].id]},{revision:againDraft.revision});
  const again=await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:againDraft.id,mode:"generate"},{revision:againSaved.data.revision,key:"direct-again"});
  const againCommand=await commandSettled(f,again.data.id);
  assert.equal(againCommand.autoExecution.state,"admitted",JSON.stringify(againCommand));
  assert.notEqual(againCommand.resultIds.executionIds[0],outputs.id);
  assert.equal((await f.settled(againCommand.resultIds.executionIds[0])).status,"completed");
});

test("image HTTP: versions persist by original, references cancel, selected download and deletion preserve other versions", async t => {
  const f = await fixture(t);
  const c = await f.create(), a = await f.task(c.conversation);
  const originalA = await f.upload(a.task), originalB = await f.upload(a.task);
  const draftPath = `/conversations/${c.conversation.id}/draft`;
  const send = async (refs, parameters, text="精修") => {
    const draft = (await f.call("GET",`${draftPath}?taskId=${a.task.id}`)).data;
    const saved = await f.call("PATCH",draftPath,{draftId:draft.id,text,profileId:"official",parameters:{schemaVersion:1,explicitParameters:{},...parameters},referenceIds:refs},{revision:draft.revision});
    assert.equal(saved.status,200,JSON.stringify(saved));
    const accepted = await f.call("POST",`/conversations/${c.conversation.id}/messages`,{draftId:draft.id,mode:"generate"},{revision:saved.data.revision});
    assert.equal(accepted.status,202,JSON.stringify(accepted));
    const done = await commandSettled(f,accepted.data.id);
    assert.equal(done.status,"completed",JSON.stringify(done));
    return f.settled(done.resultIds.executionIds[0]);
  };
  const first=await send([originalA.id,originalB.id],{inputMode:"separate"});
  assert.equal(first.status,"completed",JSON.stringify(first));
  assert.equal(f.providerCalls,2);
  let detail=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  assert.equal(detail.images.length,2);
  assert.deepEqual(detail.images.map(image=>image.latestVersionNumber),[1,1]);
  for(const image of detail.images){assert.equal(image.versions[0].versionNumber,0);assert.equal(typeof image.versions[1].readyAt,"string");}
  const aVersion1=detail.images.find(image=>image.rootAssetId===originalA.id).versions[1];
  await send([aVersion1.id],{});
  detail=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  assert.equal(detail.images.find(image=>image.rootAssetId===originalA.id).latestVersionNumber,2);
  const beforeBytes=f.store.list("assets").length;
  const draft=(await f.call("GET",`${draftPath}?taskId=${a.task.id}`)).data;
  assert.deepEqual(draft.referenceIds,[aVersion1.id]);
  const cancel=await f.call("PATCH",draftPath,{draftId:draft.id,text:"",profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[]},{revision:draft.revision});
  assert.equal(cancel.status,200);
  assert.deepEqual((await f.call("GET",`/tasks/${a.task.id}`)).data.referenceAssets,[]);
  assert.equal(f.store.list("assets").length,beforeBytes);
  const ids=detail.images.map(image=>image.versions.at(-1).id);
  const download=await f.call("POST",`/tasks/${a.task.id}/download`,{assetIds:ids});
  assert.equal(download.status,200,JSON.stringify(download));
  const {unzipSync}=require("fflate");
  assert.equal(Object.keys(unzipSync(new Uint8Array(await download.arrayBuffer()))).length,2);
  const read=f.files.read;
  let started,release;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  f.files.read=async asset=>{started();await gate;return read(asset);};
  const pending=f.call("POST",`/tasks/${a.task.id}/download`,{assetIds:[aVersion1.id]});
  await entered;
  const inUse=await f.call("DELETE",`/tasks/${a.task.id}/versions/${aVersion1.id}`,{},{revision:detail.task.revision});
  assert.equal(inUse.error.code,"IMAGE_ASSET_IN_USE");
  release();await pending;f.files.read=read;
  const remove=await f.call("DELETE",`/tasks/${a.task.id}/versions/${aVersion1.id}`,{},{revision:detail.task.revision,key:"delete-v1"});
  assert.equal(remove.status,200,JSON.stringify(remove));
  assert.equal(remove.data.cleanup.state,"done");
  assert.equal((await f.call("DELETE",`/tasks/${a.task.id}/versions/${aVersion1.id}`,{},{revision:detail.task.revision,key:"delete-v1"})).status,200);
  assert.equal((await f.call("GET",`/assets/${aVersion1.id}/content`)).status,410);
  const remaining=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  assert.deepEqual(remaining.images.find(image=>image.rootAssetId===originalA.id).versions.map(asset=>asset.versionNumber),[0,2]);
  await send([originalA.id],{});
  assert.equal((await f.call("GET",`/tasks/${a.task.id}`)).data.images.find(image=>image.rootAssetId===originalA.id).latestVersionNumber,3);
  const current=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  const cleanupTarget=current.images.find(image=>image.rootAssetId===originalA.id).versions.at(-1);
  const removeFile=f.files.remove;
  f.files.remove=async()=>{throw Error("disk unavailable");};
  const failedCleanup=await f.call("DELETE",`/tasks/${a.task.id}/versions/${cleanupTarget.id}`,{},{revision:current.task.revision,key:"cleanup-failed"});
  assert.equal(failedCleanup.data.cleanup.state,"failed");
  assert.equal((await f.call("GET",`/assets/${cleanupTarget.id}/content`)).status,410);
  f.files.remove=removeFile;
  assert.equal((await f.call("DELETE",`/tasks/${a.task.id}/versions/${cleanupTarget.id}`,{},{revision:current.task.revision,key:"cleanup-failed"})).data.cleanup.state,"done");
  const cancelDraft=(await f.call("GET",`${draftPath}?taskId=${a.task.id}`)).data;
  const clear=await f.call("PATCH",draftPath,{draftId:cancelDraft.id,text:"还有什么建议",profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[]},{revision:cancelDraft.revision});
  f.setPromptHook(async(command,_planning,attachments)=>{assert.deepEqual(JSON.parse(command.request_json).draftSnapshot.referenceIds,[]);assert.equal(attachments.length,0);return {action:"discuss",reply:"可以调整边缘。"};});
  const discussed=await f.call("POST",`/conversations/${c.conversation.id}/messages`,{draftId:cancelDraft.id},{revision:clear.data.revision});
  assert.equal((await commandSettled(f,discussed.data.id)).autoExecution.reason,"DISCUSSION_ONLY");
  assert.deepEqual((await f.call("GET",`/tasks/${a.task.id}`)).data.referenceAssets,[]);
  const uploaded=await f.upload(a.task);
  assert.equal((await f.call("GET",`/tasks/${a.task.id}`)).data.images.length,3);
  assert.equal(uploaded.versionNumber,0);
  assert.equal(f.promptCalls,1);
  const beforeDelete=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  const originalPath=path.join(f.root,"images",f.store.get("assets",originalA.id).relative_path);
  const deleted=await f.call("DELETE",`/tasks/${a.task.id}/versions/${originalA.id}`,{},{revision:beforeDelete.task.revision});
  assert.equal(deleted.status,200,JSON.stringify(deleted));
  assert.deepEqual(deleted.data.deletedAssetIds,[originalA.id]);
  assert.equal(deleted.data.cleanup.state,"done");
  await assert.rejects(fs.access(originalPath),{code:"ENOENT"});
  assert.equal((await f.call("GET",`/assets/${originalA.id}/content`)).status,410);
  const afterDelete=(await f.call("GET",`/tasks/${a.task.id}`)).data;
  const retained=afterDelete.images.find(image=>image.rootAssetId===originalA.id).versions;
  assert.deepEqual(retained.map(asset=>asset.versionNumber),[2]);
  assert.equal((await f.call("GET",`/assets/${retained[0].id}/content`)).status,200);
});

test("image HTTP: deleting an uploaded SVG removes its raster reference and retries only failed cleanup", async t => {
  const f=await fixture(t);
  const c=await f.create(), a=await f.task(c.conversation);
  const taskPath=`/tasks/${a.task.id}`;
  const draftPath=`/conversations/${c.conversation.id}/draft?taskId=${a.task.id}`;
  const form=new FormData();
  form.set("file",new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>'],"logo.svg",{type:"image/svg+xml"}));
  const uploaded=await f.call("POST",`${taskPath}/references`,form);
  assert.equal(uploaded.status,201,JSON.stringify(uploaded));
  const {asset:raster,sourceAsset:original}=uploaded.data;
  const detail=(await f.call("GET",taskPath)).data;
  assert.ok(detail.assets.find(asset=>asset.id===original.id).allowedActions.includes("delete"));
  assert.deepEqual((await f.call("GET",draftPath)).data.referenceIds,[raster.id]);
  const revision=detail.task.revision;
  assert.equal((await f.call("DELETE",`${taskPath}/versions/${raster.id}`,{},{revision})).status,404);
  const remove=f.files.remove;
  const attempted=[];
  f.files.remove=async asset=>{
    attempted.push(asset.id);
    if(asset.id===raster.id) throw Error("disk unavailable");
    await remove(asset);
  };
  const deleteOriginal=()=>f.call("DELETE",`${taskPath}/versions/${original.id}`,{},{revision,key:"delete-svg"});
  const deleted=await deleteOriginal();
  assert.equal(deleted.status,200,JSON.stringify(deleted));
  assert.deepEqual(deleted.data.deletedAssetIds,[original.id,raster.id]);
  assert.equal(deleted.data.cleanup.state,"failed");
  assert.deepEqual((await f.call("GET",draftPath)).data.referenceIds,[]);
  assert.deepEqual((await f.call("GET",taskPath)).data.assets,[]);
  for(const id of [original.id,raster.id]) assert.equal((await f.call("GET",`/assets/${id}/content`)).status,410);
  f.files.remove=async asset=>{attempted.push(asset.id);await remove(asset);};
  assert.equal((await deleteOriginal()).data.cleanup.state,"done");
  assert.deepEqual(attempted,[original.id,raster.id,raster.id]);
  for(const id of [original.id,raster.id]) {
    await assert.rejects(fs.access(path.join(f.root,"images",f.store.get("assets",id).relative_path)),{code:"ENOENT"});
  }
});

test("image HTTP: multi-image failure keeps finished versions and does not dispatch remaining inputs", async t => {
  let calls=0;
  const f=await fixture(t,{providerFactory:()=>({
    async configuration(){return {profiles:[f.profile],defaultProfileId:"official",concurrency:1};},
    async authorize(){}, parameters(_profile,values){return values;},
    async generate(){calls++;if(calls===2)throw Object.assign(Error("uncertain"),{code:"IMAGE_PROVIDER_UNCERTAIN"});return {images:[await sharp({create:{width:32,height:32,channels:4,background:"red"}}).png().toBuffer()]};}
  })});
  const c=await f.create(),a=await f.task(c.conversation);
  const assets=[];
  for(let index=0;index<3;index++)assets.push(await f.upload(a.task));
  const d=(await f.call("GET",`/conversations/${c.conversation.id}/draft?taskId=${a.task.id}`)).data;
  const saved=await f.call("PATCH",`/conversations/${c.conversation.id}/draft`,{draftId:d.id,text:"修图",profileId:"official",parameters:{schemaVersion:1,explicitParameters:{},inputMode:"separate"},referenceIds:assets.map(asset=>asset.id)},{revision:d.revision});
  const accepted=await f.call("POST",`/conversations/${c.conversation.id}/messages`,{draftId:d.id,mode:"generate"},{revision:saved.data.revision});
  const command=await commandSettled(f,accepted.data.id);
  const execution=await f.settled(command.resultIds.executionIds[0]);
  assert.equal(execution.status,"failed");assert.equal(execution.providerOutcome,"unknown");assert.equal(calls,2);
  const images=(await f.call("GET",`/tasks/${a.task.id}`)).data.images;
  assert.deepEqual(images.map(image=>image.latestVersionNumber).sort(),[0,0,1]);
});

test("image HTTP: legacy three-table schema blocks version APIs without changing the database", async t => {
  const f=await fixture(t);
  const legacy=new Database(":memory:");t.after(()=>legacy.close());
  legacy.exec(await fs.readFile(path.resolve("src/infrastructure/database/image-schema-v1.sql"),"utf8"));
  const before=legacy.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  const oldService=new ImageWorkbenchService(new ImageRepository(legacy),f.files,f.discussion,{});
  const api=createImageApi(oldService);
  const response=await api(new Request("http://test/api/images/tasks"),["tasks"]);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,"SCHEMA_INCOMPATIBLE");
  assert.deepEqual(legacy.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(),before);
});

test("image HTTP: discussion answers without image work, explicit execution and later questions preserve the result", async t => {
  const f = await fixture(t);
  f.setPromptHook(async () => ({action:"discuss",reply:"透明背景适合叠放在不同颜色的页面上。你希望用在哪里？"}));
  const first = await f.call("POST", "/conversations/submit", firstSubmission({text:"透明背景和白色背景有什么区别？"}));
  assert.equal(first.status,202,JSON.stringify(first));
  const firstDone = await commandSettled(f,first.data.command.id);
  assert.equal(firstDone.status,"completed");
  assert.deepEqual(firstDone.autoExecution,{state:"not_requested",reason:"DISCUSSION_ONLY"});
  assert.deepEqual(firstDone.resultIds.planIds,[]);
  assert.deepEqual(firstDone.resultIds.executionIds,[]);
  assert.equal(f.store.list("plans").length,0);
  assert.equal(f.store.list("assets").length,0);
  assert.equal(f.providerCalls,0);
  const send = async text => {
    const p = `/conversations/${first.data.conversationId}/draft`;
    const draft = (await f.call("GET",`${p}?taskId=${first.data.taskId}`)).data;
    const saved = await f.call("PATCH",p,{draftId:draft.id,text,profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[]},{revision:draft.revision});
    assert.equal(saved.status,200,JSON.stringify(saved));
    const accepted = await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:draft.id},{revision:saved.data.revision});
    assert.equal(accepted.status,202,JSON.stringify(accepted));
    return commandSettled(f,accepted.data.id);
  };
  f.setPromptHook(async () => ({action:"execute",reply:"我将生成透明背景的标志。",plan:{operation:"generate",intent:"标志",preserve:"",prompt:"transparent logo",profileId:"official",parameters:{},inputs:[],outputSpec:logoOutput}}));
  const generated = await send("那就生成一个透明背景标志");
  assert.equal(generated.autoExecution.state,"admitted",JSON.stringify(generated));
  assert.equal((await f.settled(generated.resultIds.executionIds[0])).status,"completed");
  const before = (await f.call("GET",`/tasks/${first.data.taskId}`)).data;
  const assetsBefore = f.store.list("assets");
  f.setPromptHook(async () => ({action:"discuss",reply:"16 像素图适合浏览器标签页，较大的图用于高清屏幕。"}));
  const question = await send("这九个尺寸各有什么用途？先不用修改");
  assert.equal(question.autoExecution.reason,"DISCUSSION_ONLY");
  assert.equal(f.providerCalls,1);
  const after = (await f.call("GET",`/tasks/${first.data.taskId}`)).data;
  assert.deepEqual(after.currentPlan,before.currentPlan);
  assert.deepEqual(after.latestExecution,before.latestExecution);
  assert.equal(after.task.revision,before.task.revision);
  assert.deepEqual(f.store.list("assets"),assetsBefore);
  for (const invalid of [
    {action:"discuss",reply:"讨论",plan:{}},
    {action:"discuss",reply:" "},
    {action:"execute",reply:"生成"},
    {action:"unknown",reply:"生成"},
  ]) {
    f.setPromptHook(async () => invalid);
    const failed = await send("继续讨论");
    assert.equal(failed.error.code,"IMAGE_PLAN_INVALID");
    assert.equal(f.providerCalls,1);
    assert.deepEqual((await f.call("GET",`/tasks/${first.data.taskId}`)).data.latestExecution,before.latestExecution);
  }
});

test("image HTTP: follow-up conversation edits explicitly selected versions and preserves references", async t => {
  const f = await fixture(t);
  f.setPromptHook(async (_command, planning) => {
    assert.equal(planning.currentPlan, null);
    return {operation:"generate",intent:"生成标志",preserve:"",prompt:"logo",profileId:"official",parameters:{},inputs:[],outputSpec:logoOutput};
  });
  const first = await f.call("POST", "/conversations/submit", firstSubmission({text:"画一个标志"}));
  assert.equal(first.status,202,JSON.stringify(first));
  const completed = await commandSettled(f,first.data.command.id);
  const generated = await f.settled(completed.resultIds.executionIds[0]);
  assert.equal(generated.status,"completed");
  const mother = generated.assets.find(asset=>asset.role==="output");
  assert.ok(mother);
  f.setPromptHook(async (command, planning, attachments) => {
    assert.equal(JSON.parse(command.request_json).draftSnapshot.text,"改成蓝色");
    assert.deepEqual(planning.references.map(asset=>asset.assetId),[mother.id]);
    assert.equal(planning.currentPlan.operation,"generate");
    assert.equal(attachments.length,1);
    return {operation:"edit",intent:"将标志改为蓝色",preserve:"形状",prompt:"blue logo",profileId:"official",parameters:{},inputs:[{assetId:mother.id,purpose:"base",position:0}],outputSpec:logoOutput};
  });
  const draftPath = `/conversations/${first.data.conversationId}/draft`;
  const draft = (await f.call("GET",`${draftPath}?taskId=${first.data.taskId}`)).data;
  const saved = await f.call("PATCH",draftPath,{draftId:draft.id,text:"改成蓝色",profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[mother.id]},{revision:draft.revision});
  const followup = await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:draft.id},{revision:saved.data.revision});
  assert.equal(followup.status,202,JSON.stringify(followup));
  assert.deepEqual(followup.data.inputSnapshot.referenceIds,[mother.id]);
  const result=await commandSettled(f,followup.data.id);
  assert.equal(result.autoExecution.state,"admitted",JSON.stringify(result));
  assert.equal((await f.settled(result.resultIds.executionIds[0])).status,"completed");
  assert.equal(f.providerCalls,2);
  assert.equal(f.store.list("tasks").length,1);
  const explicit = await f.upload({id:first.data.taskId});
  f.setPromptHook(async (_command, planning) => {
    assert.deepEqual(planning.references.map(asset=>asset.assetId),[explicit.id]);
    return {operation:"process",intent:"输出上传图片",preserve:"原样",prompt:"",profileId:null,parameters:{},inputs:[{assetId:explicit.id,purpose:"base",position:0}],outputSpec:logoOutput};
  });
  const nextDraft = (await f.call("GET",`${draftPath}?taskId=${first.data.taskId}`)).data;
  const explicitSaved = await f.call("PATCH",draftPath,{draftId:nextDraft.id,text:"改用这张图",profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[explicit.id]},{revision:nextDraft.revision});
  const explicitSent = await f.call("POST",`/conversations/${first.data.conversationId}/messages`,{draftId:nextDraft.id},{revision:explicitSaved.data.revision});
  const explicitDone = await commandSettled(f,explicitSent.data.id);
  assert.equal(explicitDone.status,"completed",JSON.stringify(explicitDone));
  assert.deepEqual(explicitDone.inputSnapshot.referenceIds,[explicit.id]);
  assert.equal((await f.settled(explicitDone.resultIds.executionIds[0])).status,"completed");
  assert.equal(f.providerCalls,2);
});

test("image HTTP: planning interrupt waits for settlement, preserves a draft, and rejects stale targets", async t => {
  const f = await fixture(t);
  const c = await f.create();
  const { task, draft } = await f.task(c.conversation);
  let entered, release, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  t.after(release);
  const observedAbort = new Promise(resolve => { aborted = resolve; });
  f.setPromptHook(async (_command,_planning,_attachments, signal) => {
    signal.addEventListener("abort", aborted, {once:true});
    entered();
    await released;
    return {operation:"generate",intent:"late result",preserve:"",prompt:"logo",profileId:"official",parameters:{},inputs:[],outputSpec:logoOutput};
  });
  const save = (text, revision) => f.call("PATCH",`/conversations/${c.conversation.id}/draft`,{draftId:draft.id,text,profileId:null,parameters:{schemaVersion:1,explicitParameters:{}},referenceIds:[]},{revision});
  const prepared = await save("first plan",draft.revision);
  const send = revision => f.call("POST",`/conversations/${c.conversation.id}/messages`,{draftId:draft.id},{revision});
  const accepted = await send(prepared.data.revision);
  await started;
  const ready = (await f.call("GET",`/tasks/${task.id}`)).data.task;
  assert.equal(ready.derivedStage,"planning");
  assert.equal(ready.title,"first plan");
  assert.deepEqual(ready.interruptTarget,{commandId:accepted.data.id});
  const isolated = new ImageWorkbenchService(f.store, f.files, {}, {});
  await assert.rejects(
    () => isolated.interrupt(task.id, ready.interruptTarget, {key:"missing-control",match:null}),
    error => error.code === "IMAGE_INTERRUPT_UNCERTAIN",
  );
  assert.equal((await f.call("GET",`/tasks/${task.id}`)).data.task.derivedStage,"planning");
  const currentDraft = (await f.call("GET",`/conversations/${c.conversation.id}/draft?taskId=${task.id}`)).data;
  const draftForLater = await save("next plan",currentDraft.revision);
  const stop = () => f.call("POST",`/tasks/${task.id}/interrupt`,ready.interruptTarget,{key:"interrupt"});
  const first = stop();
  await observedAbort;
  const pending = (await f.call("GET",`/tasks/${task.id}`)).data.task;
  assert.equal(pending.interruptPending,true);
  assert.equal(pending.derivedStage,"planning");
  assert.equal(pending.allowedActions.includes("interrupt"),false);
  const duplicate = stop();
  release();
  for (const stopped of await Promise.all([first,duplicate])) {
    assert.equal(stopped.status,200,JSON.stringify(stopped));
    assert.equal(stopped.data.task.derivedStage,"failed");
    assert.equal(stopped.data.task.errorCode,"IMAGE_TASK_INTERRUPTED");
    assert.equal(stopped.data.latestExecution,null);
  }
  assert.equal((await commandSettled(f,accepted.data.id)).error.code,"IMAGE_TASK_INTERRUPTED");
  assert.equal(f.store.list("plans").length,0);
  assert.equal(f.store.list("assets").length,0);
  assert.equal(f.providerCalls,0);
  assert.equal((await f.call("GET",`/conversations/${c.conversation.id}/draft?taskId=${task.id}`)).data.text,"next plan");
  f.setPromptHook(async () => "not JSON");
  const later = await send(draftForLater.data.revision);
  assert.equal((await stop()).error.code,"PLAN_STALE");
  assert.equal((await commandSettled(f,later.data.id)).error.code,"IMAGE_PLAN_INVALID");
  const following = (await f.call("GET",`/tasks/${task.id}`)).data.task;
  assert.equal(following.title,"next plan");
  assert.equal(following.createdAt,ready.createdAt);
});

test("image HTTP: interrupting queued and dispatched work records zero dispatch and unknown outcome respectively", async t => {
  let entered, aborted, release;
  const started = new Promise(resolve => { entered = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  t.after(release);
  let calls = 0;
  const profile = {id:"official",provider:"openai",modelId:"image",configHash:"fixed",timeoutMs:10000,limits:{maxInputs:4}};
  const f = await fixture(t,{providerFactory:() => ({
    async configuration() { return {profiles:[profile],defaultProfileId:profile.id,concurrency:1}; },
    async authorize() {}, parameters(_profile,values) { return values; },
    async generate(_profile,_operation,_prompt,_parameters,_inputs,signal) {
      calls++;
      signal.addEventListener("abort",aborted,{once:true});
      entered();
      await released;
      signal.throwIfAborted();
      throw Error("should have stopped");
    },
  })});
  const c = await f.create();
  const first = await f.task(c.conversation), second = await f.task(c.conversation);
  const confirm = async task => {
    const { result } = await f.plan(task, null, { operation: "generate" });
    const response = await f.call("POST", `/tasks/${task.id}/confirm`, {planId:result.plan.id,hash:result.plan.hash,taskRevision:result.taskRevision});
    assert.equal(response.status,202,JSON.stringify(response));
    return response.data.execution;
  };
  const firstExecution = await confirm(first.task);
  await started;
  const queued = await confirm(second.task);
  const queuedStop = await f.call("POST",`/tasks/${second.task.id}/interrupt`,{executionId:queued.id});
  assert.equal(queuedStop.status,200,JSON.stringify(queuedStop));
  assert.equal(queuedStop.data.latestExecution.error.code,"IMAGE_TASK_INTERRUPTED");
  assert.equal(queuedStop.data.latestExecution.providerOutcome,"none");
  assert.equal(calls,1);
  const request = f.call("POST",`/tasks/${first.task.id}/interrupt`,{executionId:firstExecution.id});
  await stopped;
  assert.equal((await f.call("GET",`/tasks/${first.task.id}`)).data.task.interruptPending,true);
  release();
  const stoppedExecution = await request;
  assert.equal(stoppedExecution.status,200,JSON.stringify(stoppedExecution));
  assert.equal(stoppedExecution.data.latestExecution.providerOutcome,"unknown");
  assert.equal(stoppedExecution.data.latestExecution.error.code,"IMAGE_TASK_INTERRUPTED");
  assert.ok(stoppedExecution.data.latestExecution.outputResults.every(output => output.availability === "missing"));
  assert.equal(calls,1);
});

test("image HTTP: interrupting local processing preserves ready outputs and waits for the active processing boundary", async t => {
  const f = await fixture(t);
  const c = await f.create();
  const { task } = await f.task(c.conversation);
  const asset = await f.upload(task);
  const { result } = await f.plan(task, asset, { outputSpec: { ...logoOutput, targets: logoOutput.targets.slice(0, 2) } });
  const process = f.files.process.bind(f.files);
  let entered, release, count = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  t.after(release);
  f.files.process = async (...args) => {
    if (++count === 2) {
      entered();
      await released;
    }
    return process(...args);
  };
  const { data } = await f.call("POST", `/tasks/${task.id}/confirm`, { planId: result.plan.id, hash: result.plan.hash, taskRevision: result.taskRevision });
  await started;
  const interrupt = f.call("POST", `/tasks/${task.id}/interrupt`, { executionId: data.execution.id });
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = (await f.call("GET", `/tasks/${task.id}`)).data;
    if (current.task.interruptPending) {
      assert.equal(current.task.derivedStage, "processing");
      assert.deepEqual(current.latestExecution.outputResults.map(output => output.availability), ["ready", "staging"]);
      break;
    }
    if (attempt === 19) assert.fail("processing control never became pending");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  release();
  const stopped = await interrupt;
  assert.equal(stopped.status, 200, JSON.stringify(stopped));
  assert.equal(stopped.data.latestExecution.error.code, "IMAGE_TASK_INTERRUPTED");
  assert.deepEqual(stopped.data.latestExecution.outputResults.map(output => output.availability), ["ready", "missing"]);
  const original = await f.call("GET", asset.previewUrl.replace("/api/images", ""));
  assert.equal(original.status, 200);
  const finished = await f.settled(data.execution.id);
  assert.equal(finished.providerOutcome, "none");
  assert.equal(f.providerCalls, 0);
});

test("image HTTP: capabilities selects the preferred available model or the first available configured model", async t => {
  const profiles = ["preferred", "second", "third"].map(id => ({ id, modelId:id, defaults:{}, credentialRef:"secret", baseUrl:"https://internal.test" }));
  const unavailable = new Set();
  const f = await fixture(t, { providerFactory: () => ({
    async configuration() { return { profiles, defaultProfileId: "preferred", concurrency: 1 }; },
    async authorize(profile) { if (unavailable.has(profile.id)) throw Error("unavailable"); },
  }) });
  assert.equal((await f.call("GET", "/capabilities")).data.defaultProfileId, "preferred");
  unavailable.add("preferred");
  assert.equal((await f.call("GET", "/capabilities")).data.defaultProfileId, "second");
  unavailable.add("second");
  unavailable.add("third");
  const response = await f.call("GET", "/capabilities");
  assert.equal(response.data.defaultProfileId, null);
  assert.equal(response.data.processAvailable, true);
  assert.ok(response.data.profiles.every(profile => profile.available === false && !("baseUrl" in profile) && !("credentialRef" in profile)));
});
