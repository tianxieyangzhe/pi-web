require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),Module=require('node:module');
const {test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
let hooks=[],index=0,effects=[];
const react={useState(initial){const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},useRef(value){const i=index++;return hooks[i]??={current:value};},useEffect(fn,deps){const i=index++,previous=hooks[i];if(!previous||deps.some((v,n)=>v!==previous[n])){hooks[i]=deps;effects.push(fn);}}};
const load=Module._load;Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});return load.call(this,name,...args);};
const {PromptInput}=require('../web/workspace/conversation/prompt-input.tsx');
const {ReferencePicker,ProjectReferencePicker}=require('../web/workspace/conversation/reference-picker.tsx');Module._load=load;
const {api}=require('../web/api/client.ts'),{botApi}=require('../web/api/bot-client.ts');
global.FileReader=class {readAsDataURL(file){this.result='data:application/octet-stream;base64,'+Buffer.from(file.bytes).toString('base64');this.onload();}};
function harness(onSubmit){hooks=[];function render(){index=0;effects=[];const tree=PromptInput({placeholder:'x',running:false,draftKey:'test',onSubmit});for(const effect of effects)effect();return tree;}return {render,change:value=>render().props.children[0].props.onChange({target:{value}}),select:value=>render().props.children[1].props.children[0].props.onChange(value),submit:()=>render().props.onSubmit({preventDefault(){}})};}
test('composer sends uploaded snapshots, retains files and draft on rejection, clears on acceptance',async()=>{
 const files=[{name:'a.txt',bytes:'hello'},{name:'b.png',bytes:'img'}];let reject=true,received;
 const h=harness(async(text,items)=>{received={text,items};if(reject)throw Error('invalid');});h.render();h.change('hello');h.select(files);await h.submit();
 assert.deepEqual(received,{text:'hello',items:[{name:'a.txt',data:'aGVsbG8='},{name:'b.png',data:'aW1n'}]});assert.deepEqual(h.render().props.children[1].props.children[0].props.selected,files);assert.equal(h.render().props.children[0].props.value,'hello');
 reject=false;await h.submit();assert.deepEqual(h.render().props.children[1].props.children[0].props.selected,[]);
});
test('selected files appear below compact reference buttons',()=>{
 const h=harness(()=>{});h.render();h.select([{name:'a',bytes:'A'}]);const group=h.render().props.children[1];assert.equal(group.props.className,'prompt-input__references');assert.equal(group.props.children[0].type,ReferencePicker);assert.equal(group.props.children[1].type,ProjectReferencePicker);
 const css=fs.readFileSync(require('node:path').join(__dirname,'../web/styles/app.css'),'utf8');assert.match(css,/\.prompt-input__references\s*\{[^}]*display:\s*flex[^}]*row-gap:\s*8px[^}]*padding:\s*0 12px 10px/);assert.match(css,/\.prompt-input__references\s+\.reference-picker__selected\s*\{[^}]*order:\s*1[^}]*flex:\s*0 0 100%/);
});
test('upload picker supports multiple files, removal and limits without project',()=>{
 hooks=[];let selected=[];function render(){index=0;effects=[];const tree=ReferencePicker({selected,onChange:files=>{selected=files;}});for(const effect of effects)effect();return tree;}
 let tree=render();const input=tree.props.children[1];assert.equal(input.props.type,'file');assert.equal(input.props.multiple,true);input.props.onChange({target:{files:[{name:'a',size:1},{name:'b',size:2}],value:'x'}});assert.equal(selected.length,2);
 tree=render();tree.props.children[0].props.children[0].props.children[1].props.onClick();assert.deepEqual(selected.map(x=>x.name),['b']);
 tree=render();tree.props.children[1].props.onChange({target:{files:[{name:'big',size:2*1024*1024+1}],value:'x'}});assert.equal(selected.length,1);assert.match(render().props.children[3].props.children,/容量|超过/);
});
test('project reference selector opens project directory browser without path input',async()=>{
 hooks=[];const old=api.listFiles;let calls=[],selected=[];api.listFiles=async(id,path)=>{calls.push([id,path]);return {entries:[{name:'src',path:'src',type:'directory'},{name:'a.txt',path:'a.txt',type:'file'}],truncated:false};};
 function render(){index=0;effects=[];const tree=ProjectReferencePicker({projects:[{id:'p',name:'P'}],selected,onChange:next=>{selected=next;},uploadCount:0});for(const effect of effects)effect();return tree;}
 try{let tree=render();assert.equal(tree.props.children[1].props.disabled,false);tree.props.children[1].props.onClick();render();await Promise.resolve();tree=render();const dialog=tree.props.children[2];assert.equal(dialog.type,'dialog');assert.equal(dialog.props['aria-label'],'参考项目文件');assert.deepEqual(calls,[['p','']]);const entries=dialog.props.children[3].props.children[0];entries[1].props.children[0].props.onChange();assert.deepEqual(selected,[{projectId:'p',path:'a.txt'}]);entries[0].props.onClick();render();await Promise.resolve();assert.deepEqual(calls,[['p',''],['p','src']]);}finally{api.listFiles=old;}
});
test('Bot workspace is the default reference source without project bindings',async()=>{
 hooks=[];const old=botApi.referenceFiles;let calls=[],selected=[];botApi.referenceFiles=async(b,c,p)=>{calls.push([b,c,p]);return {entries:[{name:'a',path:'a',type:'file'}],truncated:false};};function render(){index=0;effects=[];const tree=ProjectReferencePicker({projects:[],workspace:{botId:'b',conversationId:'c'},selected,onChange:next=>{selected=next;},uploadCount:0});for(const effect of effects)effect();return tree;}try{let tree=render();assert.equal(tree.props.children[1].props.disabled,false);tree.props.children[1].props.onClick();render();await Promise.resolve();tree=render();assert.deepEqual(calls,[['b','c','']]);tree.props.children[2].props.children[3].props.children[0][0].props.children[0].props.onChange();assert.deepEqual(selected,[{source:'bot',path:'a'}]);}finally{botApi.referenceFiles=old;}
});
test('composer combines upload and project selections and retains both on rejection',async()=>{
 let received;const h=harness(async(_text,refs)=>{received=refs;throw Error('invalid');});h.render();h.change('hello');h.select([{name:'a',bytes:'A'}]);h.render().props.children[1].props.children[1].props.onChange([{projectId:'p',path:'x'}]);await h.submit();assert.deepEqual(received,[{name:'a',data:'QQ=='},{projectId:'p',path:'x'}]);assert.equal(h.render().props.children[1].props.children[0].props.selected.length,1);assert.equal(h.render().props.children[1].props.children[1].props.selected.length,1);
});
test('project and Bot clients send uploaded bytes without paths',async()=>{
 const previous=global.fetch,requests=[];global.fetch=async(url,init)=>{requests.push(JSON.parse(init.body));return url.startsWith('/api/bots')?new Response(JSON.stringify({data:{accepted:true}}),{status:202}):new Response('',{status:200});};
 const refs=[{name:'note.txt',data:'eA=='}];try{await botApi.send('b','c','hello',undefined,false,refs);await api.sendMessage('p','s','hello',false,undefined,refs).next();}finally{global.fetch=previous;}
 assert.deepEqual(requests[0].references,refs);assert.deepEqual(requests[1].references,refs);
});
