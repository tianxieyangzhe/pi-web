require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {RoleDirectory}=require('../web/workspace/roles/role-directory.tsx'),{RoleEditor}=require('../web/workspace/roles/role-editor.tsx');
const {ProjectNavigation}=require('../web/workspace/sidebar/project-navigation.tsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const definition={instructions:'role',capabilities:{readFiles:true,writeFiles:false}},agent={id:'a',name:'项目角色',description:null,kind:'project',projectId:null,sourceTemplateId:null,status:'active',revision:1,contentSha256:'a'.repeat(64),definition},project={id:'p',name:'project',rootPath:'/tmp/project',status:'active'};
test('Agent click opens a list dialog with add, edit and delete actions',()=>{
 const html=render(RoleDirectory,{open:true,roles:[agent],onRefresh:async()=>{},onClose(){},onEdit(){}});assert(html.includes('Agent 列表'));assert(html.includes('新增 Agent'));assert(html.includes('修改'));assert(html.includes('删除'));assert(html.includes('项目角色'));assert(html.includes('ui-button ui-button--primary'));assert(html.includes('ui-button--secondary'));assert(html.includes('ui-button--danger'));
});
test('new Project action is placed in the Project section header',()=>{
 const noop=()=>{},html=render(ProjectNavigation,{projects:[],selection:null,navigation:{},creatingSessionProjectId:null,onNewProject:noop,onOpenTemplates:noop,onNewProjectSession:noop,onCreateSession:noop,onProjectSelect:noop,onSessionSelect:noop,onEditProject:noop,onOpenResource:noop});
 const actionsIndex=html.indexOf('class="sidebar__actions"'),projectHeaderIndex=html.indexOf('class="sidebar__label project-navigation__section-heading"');
 assert(actionsIndex>=0&&projectHeaderIndex>actionsIndex);assert(html.includes('aria-label="新建项目"'));assert(!html.slice(actionsIndex,projectHeaderIndex).includes('aria-label="新建项目"'));
});
