require('./register.cjs');
const fs=require('node:fs'),swc=require('next/dist/build/swc'),{test}=require('node:test'),assert=require('node:assert/strict');
require.extensions['.tsx']=function(module,file){const result=swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});module._compile(result.code,file);};
const {shouldSubmitOnEnter}=require('../web/workspace/conversation/prompt-input.tsx');

function enter({shiftKey=false,isComposing=false,keyCode=13}={}){
  return {key:'Enter',shiftKey,nativeEvent:{isComposing,keyCode}};
}

test('Enter submits after IME composition ends while Shift+Enter stays multiline',()=>{
  assert.equal(shouldSubmitOnEnter(enter(),false),true);
  assert.equal(shouldSubmitOnEnter(enter({shiftKey:true}),false),false);
  assert.equal(shouldSubmitOnEnter(enter(),true),false);
});

test('Enter confirms IME candidates without submitting, including legacy IME keyCode',()=>{
  assert.equal(shouldSubmitOnEnter(enter({isComposing:true}),false),false);
  assert.equal(shouldSubmitOnEnter(enter({keyCode:229}),false),false);
});
