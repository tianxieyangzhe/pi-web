require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {RoleDirectory}=require('../web/workspace/roles/role-directory.tsx'),{RoleVersion,compareAgentVersion}=require('../web/workspace/roles/role-version.tsx'),{RoleEditor}=require('../web/workspace/roles/role-editor.tsx'),{BotParticipants}=require('../web/workspace/inspector/bot-participants.tsx');
const {BotCreateDialog}=require('../web/workspace/sidebar/bot-create-dialog.tsx');
const {BotNavigation}=require('../web/workspace/sidebar/bot-navigation.tsx');
const {ProjectNavigation}=require('../web/workspace/sidebar/project-navigation.tsx');
const {ProjectAgentPicker}=require('../web/workspace/roles/project-agent-picker.tsx');
const {BotHome}=require('../web/workspace/roles/bot-home.tsx');
const {botApi}=require('../web/api/bot-client.ts');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const {BotConversationView}=require('../web/workspace/conversation/bot-conversation/bot-conversation-view.tsx'),{ProjectSessionView}=require('../web/workspace/conversation/project-session/project-session-view.tsx');
test('project and Bot message composers have no extra project-write checkbox',()=>{
 const noop=()=>{};
 const session={sessions:[],messages:[],activities:[],running:false,compacting:false,pendingText:'',streamingText:'',send:noop,interrupt:noop,setError:noop};
 const projectHtml=render(ProjectSessionView,{project:{id:'p',name:'project'},session});
 const botHtml=render(BotConversationView,{state:{detail:null,messages:[],send:noop,control:noop},onRole:noop,onManage:noop});
 assert(!projectHtml.includes('允许项目修改'));assert(!botHtml.includes('允许项目修改'));
 assert(projectHtml.includes('发送'));assert(botHtml.includes('发送'));
});
test('paused Bot scheduling leaves coordinator chat available and offers resume',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'新对话',goal:'',status:'open',schedulingMode:'paused',agentSnapshot:{agentId:'a'},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[],messages:[],canAcceptUserMessage:true,coordinationPending:false},messages:[],send:async()=>{},control:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop});assert(html.includes('项目调度已暂停'));assert(html.includes('继续项目调度'));assert(html.includes('向 新对话 发送消息'));assert(html.includes('发送'));
});
test('Bot shows bound dispatch capability and the latest coordinator failure directly',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'新对话',goal:'',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'a',definition:{capabilities:{dispatchTasks:false}}},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[{id:'failed',targetSessionId:null,status:'failed',errorMessage:'配置的模型没有可用渠道'}],messages:[]},messages:[],send:async()=>{},control:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop});assert(html.includes('当前协调 Agent 未开启派发任务能力'));assert(html.includes('配置的模型没有可用渠道'));
});
test('Bot conversation asks the user before revising a diagnosed Agent definition',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'总对话',goal:'',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord'},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[{id:'diagnosis',targetSessionId:null,status:'failed',agentSnapshot:{agentId:'a',name:'项目 Agent',revision:2},resultJson:{summary:'blocked',verification:'not_run',blockers:['review'],agentDefinitionIssue:{summary:'要求调用不存在的工具',evidenceEntryIds:['e1','e2']}}}],messages:[]},messages:[],send:async()=>{},control:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop,onReviewAgentIssue:noop});
 assert(html.includes('Agent.md 可能需要调整'));assert(html.includes('尚待你判断'));assert(html.includes('要求调用不存在的工具'));
 assert(html.includes('查看并修改 Agent.md'));assert(html.includes('暂不修改'));assert(html.includes('2 条证据'));
});
test('unknown message remains uncertain with precise recovery actions',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'总对话',goal:'',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord',name:'Coordinator',revision:1,definition:{capabilities:{dispatchTasks:true}}},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[{id:'e',targetSessionId:null,status:'failed',errorMessage:'模型失败',agentSnapshot:{agentId:'coord'}}],messages:[{id:'m',sourceKind:'user',targetSessionId:null,deliveryStatus:'unknown',content:'我的请求',withdrawRequestedAt:null}]},messages:[],control:async()=>{},send:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop,onReviewAgentIssue:noop});
 assert(html.includes('消息送达状态未知'));assert(html.includes('请求撤回'));assert(html.includes('核对 Pi 历史'));assert(html.includes('模型失败'));assert(!html.includes('明确取消消息'));
});
test('proven preflight rejection is shown as unsent input with an explicit retry action',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'总对话',goal:'',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord'},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[{id:'failed',targetSessionId:null,status:'failed',errorCode:'BOT_INPUT_TOO_LARGE',errorMessage:'输入超过预算'}],messages:[{id:'m',sourceKind:'user',targetSessionId:null,deliveryStatus:'pending',content:'你好'}],canRetryPreflightMessageIds:['m']},messages:[],control:async()=>{},send:async()=>{},retryPreflightMessage:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},retryReceivedMessage:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop,onReviewAgentIssue:noop});assert(html.includes('输入未送达'));assert(html.includes('重新处理原输入'));assert(!html.includes('消息送达状态未知'));assert(!html.includes('请求撤回'));assert(html.includes('预算预检确认没有写入 Pi 历史'));
});
test('delivered input processing retry is explicit and distinct from redelivery',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'总对话',goal:'',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord'},roleState:{available:true}},participants:[],works:[],tasks:[],dependencies:[],executions:[{id:'failed',targetSessionId:null,status:'failed',operation:'project_write',errorMessage:'模型调用失败'}],messages:[{id:'m',sourceKind:'user',targetSessionId:null,deliveryStatus:'delivered',targetNativeEntryId:'entry',content:'读取项目情况'}],canResumeReceivedMessageIds:['m']},messages:[],control:async()=>{},send:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},retryReceivedMessage:async()=>{},error:''},noop=()=>{};
 const html=render(BotConversationView,{state,onRole:noop,onManage:noop,onReviewAgentIssue:noop});assert(html.includes('消息已送达，处理调用失败'));assert(html.includes('继续处理原输入'));assert(!html.includes('重新发送原消息'));
});
test('Agent editor frames a reviewed issue as an unsaved draft with prefilled feedback',()=>{
 const resource={...agent,contentSha256:'a'.repeat(64),revision:2,writeETag:'w'};
 const html=render(RoleEditor,{target:{resource,initialFeedback:'检查项目结果中的证据冲突'},projects:[project],onClose(){},onSaved(){}});
 assert(html.includes('当前协调总对话报告此角色定义可能存在问题'));assert(html.includes('检查项目结果中的证据冲突'));assert(html.includes('未保存草稿'));
});
test('coordinator canvas keeps one transcript and shows the active target Sessions as top tabs',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'协调会话',goal:'核验并总结',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord',name:'协调者'},roleState:{available:true}},participants:[{id:'s1',projectId:'p',projectName:'项目甲',topic:'接口主题',roleName:'项目 Agent',collaborationState:'active'},{id:'s2',projectId:'p2',projectName:'项目乙',topic:'部署主题',roleName:'部署 Agent',collaborationState:'active'}],works:[{id:'w',title:'核验接口',goal:'检查并总结',status:'completed'}],tasks:[{id:'t1',workId:'w',targetSessionId:'s1',title:'检查 API',instruction:'检查接口定义',acceptanceCriteria:['接口可用'],status:'completed',waitingForMessageId:null},{id:'t2',workId:'w',targetSessionId:'s1',title:'检查调用方',instruction:'找调用处',acceptanceCriteria:[],status:'completed',waitingForMessageId:null},{id:'t3',workId:'w',targetSessionId:'s2',title:'核验部署',instruction:'检查部署',acceptanceCriteria:[],status:'completed',waitingForMessageId:null}],dependencies:[],executions:[{id:'coordinator-e',targetSessionId:null,status:'completed',resultJson:{summary:'协调摘要不得复制',verification:'passed',blockers:[]}},{id:'project-e',targetSessionId:'s1',status:'completed',resultJson:{summary:'项目摘要不得复制',verification:'passed',blockers:[]}}],messages:[],allowedActions:[],canRetryTaskIds:[],canAcceptUserMessage:true,sessionCapabilities:[],blockingReasons:[]},messages:[{id:'n1',role:'assistant',executionId:'coordinator-e',content:'协调历史里的最终汇总',createdAt:'2026-10-20T00:01:00Z'}],liveExecutions:[],send:async()=>{},control:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''};
 const html=render(BotConversationView,{state,projects:[project],agents:[agent],onRole(){},onManage(){}});
 assert.equal((html.match(/role="tab"/g)||[]).length,3);assert.equal((html.match(/role="tablist"/g)||[]).length,1);
 assert(html.includes('项目甲 · 接口主题'));assert(html.includes('项目乙 · 部署主题'));assert(html.includes('协调历史里的最终汇总'));
 assert(!html.includes('项目摘要不得复制'));assert(!html.includes('bot-work-output'));assert(!html.includes('bot-progress'));
});
test('the project transcript and Composer are routed by the selected Session id',()=>{
 const hook=fs.readFileSync(require.resolve('../web/workspace/conversation/bot-conversation/use-bot-conversation.ts'),'utf8'),view=fs.readFileSync(require.resolve('../web/workspace/conversation/bot-conversation/bot-conversation-view.tsx'),'utf8');
 assert(hook.includes('api.listMessages(participant.projectId,participant.id)'));
 assert(hook.includes('botApi.send(botId, conversationId, text,targetSessionId)'));
 assert(view.includes('onSubmit={text=>state.send(text,coordinatorSelected?undefined:selectedKey)}'));
 assert(view.includes('role="tabpanel"'));assert(view.includes('id={`bot-session-panel-${selectedKey}`}'));
});
test('sending from a project tab records the exact targetSessionId through the parent Bot API',async()=>{
 const originalFetch=global.fetch;let request;
 global.fetch=async(url,init)=>{request={url,init};return {ok:true,json:async()=>({data:{id:'message'}})};};
 try{await botApi.send('bot','conversation','直接询问项目','project-session');}finally{global.fetch=originalFetch;}
 assert.match(request.url,/\/api\/bots\/bot\/conversations\/conversation\/messages$/);
 assert.deepEqual(JSON.parse(request.init.body),{content:'直接询问项目',targetSessionId:'project-session',steer:false});
});
test('the Bot inspector does not offer detached execution or message recovery actions',()=>{
 const source=fs.readFileSync(require.resolve('../web/workspace/inspector/bot-settings.tsx'),'utf8');
 assert(source.includes('请在总对话中对应的 Session 标签处理'));
 assert(!source.includes("'resolve_message'"));assert(!source.includes("'resolve'"));assert(!source.includes('retry(b,c,task.id)'));
});
test('Work stop belongs to the coordinator transcript and in-flight work blocks coordinator input',()=>{
 const state={detail:{bot:{id:'b',name:'Bot',status:'active'},conversation:{id:'c',title:'协调会话',goal:'检查项目',status:'open',schedulingMode:'enabled',agentSnapshot:{agentId:'coord',name:'协调者'},roleState:{available:true}},participants:[{id:'child',projectId:'p',projectName:'project',topic:'接口核验',roleName:'项目 Agent',collaborationState:'active'}],works:[{id:'w',title:'核验接口',goal:'检查项目接口',status:'open'}],tasks:[{id:'t',workId:'w',title:'检查 API',instruction:'核验 API',acceptanceCriteria:['API 可用'],status:'open',waitingForMessageId:null,targetSessionId:'child'}],dependencies:[],executions:[{id:'e',workId:'w',taskId:'t',targetSessionId:'child',status:'queued'}],messages:[],coordinationPending:true,canAcceptUserMessage:false,displayPhase:'executing',blockingReasons:[{code:'EXECUTION_QUEUED',entityType:'execution',entityId:'e',reason:'同一 Session 正在执行'}],allowedActions:[{action:'stop_work',entityType:'work',entityId:'w'}],sessionCapabilities:[]},messages:[],liveExecutions:[],send:async()=>{},control:async()=>{},stopWork:async()=>{},withdrawMessage:async()=>{},retryTask:async()=>{},error:''};
 const html=render(BotConversationView,{state,projects:[project],agents:[agent],onRole(){},onManage(){}});
 assert(html.includes('核验接口'));assert(html.includes('停止本次工作'));assert(html.includes('项目 Session 正在处理；结果返回并由协调者汇总后，协调输入会恢复。'));assert(/<textarea[^>]*disabled=""/.test(html));
 const stoppingState={...state,detail:{...state.detail,works:[{...state.detail.works[0],status:'cancelled'}],executions:[{...state.detail.executions[0],status:'running',cancelRequestedAt:'now'}]}};
 assert(render(BotConversationView,{state:stoppingState,projects:[project],agents:[agent],onRole(){},onManage(){}}).includes('正在停止'));
 const uncertainState={...stoppingState,detail:{...stoppingState.detail,executions:[{...stoppingState.detail.executions[0],status:'unknown'}]}};
 assert(render(BotConversationView,{state:uncertainState,projects:[project],agents:[agent],onRole(){},onManage(){}}).includes('停止后待核对'));
});
const definition={instructions:'role',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:true}},agent={id:'a',name:'项目角色',description:null,kind:'project',projectId:null,botId:null,sourceTemplateId:null,status:'active',revision:1,contentSha256:'a'.repeat(64),definition},project={id:'p',name:'project',rootPath:'/tmp/project',status:'active'};
test('Agent click opens a list dialog with add, edit and delete actions',()=>{
 const html=render(RoleDirectory,{open:true,roles:[agent],onRefresh:async()=>{},onClose(){},onEdit(){}});assert(html.includes('Agent 列表'));assert(html.includes('新增 Agent'));assert(html.includes('修改'));assert(html.includes('删除'));assert(html.includes('项目角色'));assert(html.includes('ui-button ui-button--primary'));assert(html.includes('ui-button--secondary'));assert(html.includes('ui-button--danger'));
});
test('new Bot form binds an independent coordinator Agent and searchable Project scope',()=>{
 const html=render(BotCreateDialog,{projects:[project],agents:[agent],onClose(){},onSaved(){}});assert(html.includes('新建 Bot'));assert(html.includes('协调 Agent'));assert(!html.includes('<h3>协调 Agent</h3>'));assert(html.includes('项目范围'));assert(html.includes('搜索项目名称或路径'));assert(html.includes('Agent 定义在角色列表中独立创建'));
 assert(html.includes('ui-button--secondary'));assert(html.includes('ui-button--primary'));
});
test('Bot home and role selectors present form actions as visible buttons',()=>{
 const bot={id:'b',name:'Bot',description:null,workingDirectory:'/tmp/bot',workspaceKind:'managed',coordinatorAgentId:null,coordinatorAgentSnapshot:null,projectBindings:[],maxParallelExecutions:4,status:'active',writeETag:'w'},
  html=render(BotHome,{bot,projects:[project],agents:[agent],onRefresh:async()=>{},onConversation(){}});
 assert(html.includes('ui-button ui-button--secondary'));assert(html.includes('ui-button ui-button--primary'));assert(html.includes('新增 Agent'));
});
test('project Agent binding presents an accessible searchable single-select trigger',()=>{
 const html=render(ProjectAgentPicker,{agents:[agent],selectedIds:[],onChange(){}});assert(html.includes('绑定项目 Agent'));assert(html.includes('搜索并选择 Agent'));assert(html.includes('0/1'));assert(html.includes('aria-expanded="false"'));assert(/aria-controls="[^"]+"/.test(html));
});
test('archived Bots are omitted while active Bots remain in the sidebar',()=>{
 const archived={id:'archived',name:'anp-v5',description:null,workingDirectory:'/tmp/bot',workspaceKind:'managed',coordinatorAgentId:null,coordinatorAgentSnapshot:null,maxParallelExecutions:4,status:'archived',writeETag:'archived'},active={...archived,id:'active',name:'Active Bot',status:'active'},
  html=render(BotNavigation,{value:{available:true,bots:[active,archived],conversations:[],participants:[]},selection:null,onBot(){},onCreate(){},onConversation(){},onNewConversation(){}});
 assert(!html.includes('已归档 Bot'));assert(!html.includes('anp-v5'));assert(html.includes('Active Bot'));
});
test('Bot navigation nests each project Session under its coordinator conversation',()=>{
 const bot={id:'b',name:'Bot',description:null,workingDirectory:'/tmp/bot',workspaceKind:'managed',coordinatorAgentId:'coord',coordinatorAgentSnapshot:{agentId:'coord'},maxParallelExecutions:4,status:'active',writeETag:'w'},conversation={id:'c',botId:'b',title:'协调任务',createdAt:'2026-10-19T00:00:00Z'},participant={id:'s',botConversationId:'c',projectId:'p',projectName:'oam',roleName:'oam Agent',topic:'定位 main 函数',participantName:null,assignment:null,collaborationState:'active',writeETag:'w'};
 const html=render(BotNavigation,{value:{available:true,bots:[bot],conversations:[conversation],participants:[participant]},selection:{kind:'bot-conversation',botId:'b',conversationId:'c'},onBot(){},onCreate(){},onConversation(){},onProjectSession(){},onNewConversation(){}});
 assert(html.includes('aria-label="协调任务 的项目会话"'));assert(html.includes('定位 main 函数'));assert(html.includes('oam · oam Agent'));
 assert(html.indexOf('class="bot-conversations"')<html.indexOf('class="bot-conversation-sessions"'));
});
test('new Project action is placed in the Project section header',()=>{
 const noop=()=>{},html=render(ProjectNavigation,{projects:[],selection:null,navigation:{},creatingSessionProjectId:null,onNewProject:noop,onOpenTemplates:noop,onNewProjectSession:noop,botNavigation:null,onCreateSession:noop,onProjectSelect:noop,onSessionSelect:noop,onEditProject:noop,onOpenResource:noop});
 const actionsIndex=html.indexOf('class="sidebar__actions"'),projectHeaderIndex=html.indexOf('class="sidebar__label project-navigation__section-heading"');
 assert(actionsIndex>=0&&projectHeaderIndex>actionsIndex);assert(html.includes('aria-label="新建项目"'));assert(!html.slice(actionsIndex,projectHeaderIndex).includes('aria-label="新建项目"'));
});
test('Bot-created Project Sessions are excluded from the Project navigation tree',()=>{
 const botSession={id:'bot-session',memorySummary:'',agent:{name:'管理面 Agent'},botParent:{conversationTitle:'跨项目协调'},state:'not_started'},independentSession={id:'independent',memorySummary:'独立工作',agent:{name:'项目 Agent'},botParent:null,state:'not_started'},noop=()=>{};
 const navigation={expandedProjectIds:new Set(['p']),sessionsByProject:{p:[botSession,independentSession]},loadingProjectIds:new Set(),errorsByProject:{},toggleProject:noop,loadProjectSessions:noop};
 const html=render(ProjectNavigation,{projects:[project],selection:{kind:'project',projectId:'p',sessionId:botSession.id},navigation,creatingSessionProjectId:null,botNavigation:null,onNewProject:noop,onOpenTemplates:noop,onNewProjectSession:noop,onCreateSession:noop,onProjectSelect:noop,onSessionSelect:noop,onEditProject:noop,onOpenResource:noop});
 assert(html.includes('独立工作'));assert(!html.includes('管理面 Agent'));assert(!html.includes('跨项目协调'));assert.equal((html.match(/aria-current="page"/g)||[]).length,0);
});
test('stable started role UI offers explicit adoption of the same Agent latest version',()=>{
 const html=render(RoleVersion,{agentId:'a',kind:'project',projectId:'p',projects:[project],state:{configured:true,available:true,name:'role',boundRevision:1,currentRevision:2,status:'active',canAdoptLatest:true,reason:null},onAdopt:async()=>{}});assert(html.includes('会话 v1 / 目录 v2'));assert(html.includes('采用同一角色最新版'));assert(html.includes('查看/修改目录角色'));assert(html.includes('ui-button ui-button--secondary ui-button--small'));
});
test('Agent adoption comparison reports guidance and capability changes before confirmation',()=>{
 const snapshot={agentId:'a',kind:'project',revision:1,botId:null,projectId:null,contentSha256:'a'.repeat(64),name:'role',description:null,definition:{instructions:'旧指导',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false}}},latest={...agent,revision:2,definition:{...definition,instructions:'新指导',capabilities:{...definition.capabilities,writeFiles:true}}},difference=compareAgentVersion(snapshot,latest);
 assert.equal(difference.instructionsChanged,true);assert.deepEqual(difference.capabilityChanges.map(change=>[change.label,change.before,change.after]),[['修改项目文件',false,true],['角色间协作消息',false,true]]);
});
test('role editor and participants expose full preparation and memory/assignment flow without identity form fields',()=>{
 const html=render(RoleEditor,{target:{kind:'project'},projects:[project],onClose(){},onSaved(){}});assert(html.includes('上传参考文件'));assert(html.includes('参考项目'));assert(html.includes('输入 Agent 修改意见'));assert(html.includes('Agent.md'));assert(!html.includes('角色指导正文'));assert(html.includes('明确设置运行能力'));assert(html.includes('项目 Session 执行'));assert(!html.includes('检索 Bot 已绑定项目'));assert(html.includes('ui-button ui-button--primary'));assert(html.includes('ui-button ui-button--secondary'));
 assert(html.includes('<section class="role-editor"'));assert(!html.includes('<dialog'));
 const detail={bot:{id:'b'},conversation:{id:'c'},participants:[{id:'s',projectName:'project',roleName:'role',collaborationState:'active',writeETag:'w',roleState:{available:true}}]};
 const participants=render(BotParticipants,{detail,projects:[project],onRefresh:async()=>{},onRole(){}});assert(participants.includes('修改分工'));assert(participants.includes('停用参与'));assert(participants.includes('记忆模板'));assert(participants.includes('纳入已有会话'));assert(participants.includes('ui-button ui-button--primary'));assert(participants.includes('ui-button ui-button--secondary ui-button--small'));assert(!participants.includes('roleKey'));assert(!participants.includes('bindingId'));
});
