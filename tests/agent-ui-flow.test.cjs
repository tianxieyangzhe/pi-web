require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {RoleDirectory}=require('../web/workspace/roles/role-directory.tsx'),{RoleVersion,compareAgentVersion}=require('../web/workspace/roles/role-version.tsx'),{RoleEditor}=require('../web/workspace/roles/role-editor.tsx');
const {ProjectNavigation}=require('../web/workspace/sidebar/project-navigation.tsx');
const {ProjectAgentPicker}=require('../web/workspace/roles/project-agent-picker.tsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const definition={instructions:'role',capabilities:{readFiles:true,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:true}},agent={id:'a',name:'项目角色',description:null,kind:'project',projectId:null,botId:null,sourceTemplateId:null,status:'active',revision:1,contentSha256:'a'.repeat(64),definition},project={id:'p',name:'project',rootPath:'/tmp/project',status:'active'};
test('Agent editor frames a reviewed issue as an unsaved draft with prefilled feedback',()=>{
 const resource={...agent,contentSha256:'a'.repeat(64),revision:2,writeETag:'w'};
 const html=render(RoleEditor,{target:{resource,initialFeedback:'检查项目结果中的证据冲突'},projects:[project],onClose(){},onSaved(){}});
 assert(html.includes('当前协调总对话报告此角色定义可能存在问题'));assert(html.includes('检查项目结果中的证据冲突'));assert(html.includes('未保存草稿'));
});
test('Agent click opens a list dialog with add, edit and delete actions',()=>{
 const html=render(RoleDirectory,{open:true,roles:[agent],onRefresh:async()=>{},onClose(){},onEdit(){}});assert(html.includes('Agent 列表'));assert(html.includes('新增 Agent'));assert(html.includes('修改'));assert(html.includes('删除'));assert(html.includes('项目角色'));assert(html.includes('ui-button ui-button--primary'));assert(html.includes('ui-button--secondary'));assert(html.includes('ui-button--danger'));
});
test('project Agent binding presents an accessible searchable single-select trigger',()=>{
 const html=render(ProjectAgentPicker,{agents:[agent],selectedIds:[],onChange(){}});assert(html.includes('绑定项目 Agent'));assert(html.includes('搜索并选择 Agent'));assert(html.includes('0/1'));assert(html.includes('aria-expanded="false"'));assert(/aria-controls="[^"]+"/.test(html));
});
test('new Project action is placed in the Project section header',()=>{
 const noop=()=>{},html=render(ProjectNavigation,{projects:[],selection:null,navigation:{},creatingSessionProjectId:null,onNewProject:noop,onOpenTemplates:noop,onNewProjectSession:noop,botNavigation:null,onCreateSession:noop,onProjectSelect:noop,onSessionSelect:noop,onEditProject:noop,onOpenResource:noop});
 const actionsIndex=html.indexOf('class="sidebar__actions"'),projectHeaderIndex=html.indexOf('class="sidebar__label project-navigation__section-heading"');
 assert(actionsIndex>=0&&projectHeaderIndex>actionsIndex);assert(html.includes('aria-label="新建项目"'));assert(!html.slice(actionsIndex,projectHeaderIndex).includes('aria-label="新建项目"'));
});
test('Bot-created Project Sessions are excluded from the Project navigation tree',()=>{
 const botSession={id:'bot-session',purpose:'',agent:{name:'管理面 Agent'},botParent:{conversationTitle:'跨项目协调'},state:'not_started'},independentSession={id:'independent',purpose:'独立工作',agent:{name:'项目 Agent'},botParent:null,state:'not_started'},noop=()=>{};
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