require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assertBotBudget,botInputByteLimit}=require('../src/domain/bot.ts');

test('Bot input budget admits large but bounded CJK instructions within the configured context reserve',()=>{
  assert.doesNotThrow(()=>assertBotBudget('角色指导','中'.repeat(20_000),[]));
});

test('Bot input budget still rejects oversized text or serialized tool schemas before Pi is called',()=>{
  assert.throws(()=>assertBotBudget('','中'.repeat(27_000),[]),error=>error.code==='BOT_INPUT_TOO_LARGE');
  assert.throws(()=>assertBotBudget('','用户输入',{description:'中'.repeat(27_000)}),error=>error.code==='BOT_INPUT_TOO_LARGE');
  assert.throws(()=>assertBotBudget('','a'.repeat(48_001),[]),error=>error.code==='BOT_INPUT_TOO_LARGE');
});

test('Bot input byte ceiling adapts to the selected model window while preserving output and history room',()=>{
  assert.equal(botInputByteLimit(128_000,16_384),80_000);
  assert.equal(botInputByteLimit(64_000,16_384),31_616);
  assert.equal(botInputByteLimit(32_000,16_384),7_616);
});
