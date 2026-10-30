require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),Module=require('node:module');
const {test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
let hooks=[],index=0,effects=[];
const react={useState(initial){const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},useRef(value){const i=index++;return hooks[i]??= {current:value};},useEffect(fn,deps){const i=index++,previous=hooks[i];if(!previous||deps.some((v,n)=>v!==previous[n])){hooks[i]=deps;effects.push(fn);}}};
const load=Module._load;Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='lucide-react')return {ArrowUp(){},LoaderCircle(){},Square(){}};return load.call(this,name,...args);};
const {PromptInput}=require('../web/workspace/conversation/prompt-input.tsx');Module._load=load;
function harness(onSubmit){
 hooks=[];let key='a-'+Math.random(),running=false;
 function render(){index=0;effects=[];const tree=PromptInput({placeholder:'type',running,draftKey:key,onSubmit});for(const effect of effects)effect();return tree;}
 function textarea(){return render().props.children[0];}
 return {render,textarea,change(value){textarea().props.onChange({target:{value}});},submit(){return render().props.onSubmit({preventDefault(){}});},switchKey(next){key=next;render();},getKey(){return key;},setRunning(v){running=v;}};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('clears submitted input immediately while the stream is running',async()=>{
 const d=deferred(),sent=[];const h=harness(value=>{sent.push(value);return d.promise;});h.render();h.change(' hello ');
 const pending=h.submit();assert.deepEqual(sent,['hello']);h.setRunning(true);assert.equal(h.textarea().props.value,'');
 d.resolve();await pending;assert.equal(h.textarea().props.value,'');
});
test('failed request restores original text without replacing another session draft',async()=>{
 const d=deferred(),h=harness(()=>d.promise);h.render();h.change('original');const pending=h.submit();h.switchKey('other-'+Math.random());h.change('other text');d.reject(Error('rejected'));await pending;assert.equal(h.textarea().props.value,'other text');
});
test('failed request restores original session draft after switching away and back',async()=>{
 const d=deferred(),h=harness(()=>d.promise);h.render();const firstKey=h.getKey();
 h.change('original');const pending=h.submit();h.switchKey('other-'+Math.random());
 d.reject(Error('rejected'));await pending;h.switchKey(firstKey);assert.equal(h.textarea().props.value,'original');
});
test('failure cannot overwrite edits made after submission, including edit back to empty',async()=>{
 const d=deferred(),h=harness(()=>d.promise);h.render();h.change('original');const pending=h.submit();h.change('new');h.change('');d.reject(Error('rejected'));await pending;assert.equal(h.textarea().props.value,'');
});
