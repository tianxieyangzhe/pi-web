require('./register.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
require.extensions['.tsx']=function(module,file){const r=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(r.code,file);};
const {isSelected,selectedProjectId}=require('../web/workspace/sidebar/workspace-selection.ts');
const {BotNavigation}=require('../web/workspace/sidebar/bot-navigation.tsx'),{ProjectNavigation}=require('../web/workspace/sidebar/project-navigation.tsx');
test('one workspace selection highlights exactly one Bot or Project source',()=>{
 const targets=[['bot','b'],['bot-conversation','c'],['project','p'],['project-session','s']];
 const states=[{kind:'bot',botId:'b'},{kind:'bot-conversation',botId:'b',conversationId:'c'},{kind:'project',projectId:'p'},{kind:'project',projectId:'p',sessionId:'s'}];
 for(let i=0;i<states.length;i++){const highlighted=targets.filter(([kind,id])=>isSelected(states[i],kind,id));assert.deepEqual(highlighted,[targets[i]]);}
 assert.equal(selectedProjectId(states[0]),null);assert.equal(selectedProjectId(states[2]),'p');assert.equal(selectedProjectId(states[3]),'p');assert(targets.every(([kind,id])=>!isSelected(null,kind,id)));
});
test('Bot navigation nests child Project Sessions under their coordinator and omits them from Project tree',()=>{
 const project={id:'p',name:'Project',status:'active'},session={id:'s',memorySummary:'session',state:'idle',botParent:{conversationTitle:'协调对话'}},independent={id:'ind',memorySummary:'独立记录',state:'idle',botParent:null};
 const overview={available:true,bots:[{id:'b',name:'Bot'}],conversations:[{id:'c',botId:'b',title:'协调对话'}],participants:[{id:'s',botConversationId:'c',projectId:'p',projectName:'Project',roleName:'项目 Agent',topic:'session'}]};
 const noop=()=>{},navigation={expandedProjectIds:new Set(['p']),sessionsByProject:{p:[session,independent]},loadingProjectIds:new Set(),errorsByProject:{},toggleProject:noop,loadProjectSessions:noop};
 const selection={kind:'project',projectId:'p',sessionId:'s'},botNavigation=React.createElement(BotNavigation,{value:overview,selection,onBot:noop,onCreate:noop,onConversation:noop,onProjectSession:noop,onNewConversation:noop});
 const html=renderToStaticMarkup(React.createElement(ProjectNavigation,{projects:[project],selection,navigation,creatingSessionProjectId:null,botNavigation,onNewProject:noop,onOpenTemplates:noop,onNewProjectSession:noop,onCreateSession:noop,onProjectSelect:noop,onSessionSelect:noop,onEditProject:noop,onOpenResource:noop}));
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);assert.equal((html.match(/class="[^\"]* active"/g)||[]).length,1);
 const active=html.match(/<button[^>]*aria-current="page"[^>]*>(.*?)<\/button>/s)[1];assert(active.includes('session'));
 const botArea=html.slice(0,html.indexOf('class="sidebar__label project-navigation__section-heading"'));
 assert(botArea.includes('项目 Agent'));assert(botArea.includes('收起 协调对话 的项目会话'));
 const projectArea=html.slice(html.indexOf('class="sidebar__label project-navigation__section-heading"'));
 assert(projectArea.includes('独立记录'));assert(!projectArea.includes('协调对话'));assert(!projectArea.includes('<span class="project-session-link__label">session</span>'));
 const botConversationHtml=renderToStaticMarkup(React.createElement(BotNavigation,{value:overview,selection:{kind:'bot-conversation',botId:'b',conversationId:'c'},onBot:noop,onCreate:noop,onConversation:noop,onProjectSession:noop,onNewConversation:noop}));
 assert(botConversationHtml.includes('协调对话'));assert(botConversationHtml.includes('项目 Agent'));assert.equal((botConversationHtml.match(/aria-current="page"/g)||[]).length,1);
});
