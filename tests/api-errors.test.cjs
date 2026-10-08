require('./register.cjs');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {errorResponse}=require('../src/shared/protocol/api.ts');
test('domain errors crossing route bundle boundaries keep their safe diagnostic',async()=>{
  const error=new Error('Old schema requires migration');error.name='DomainError';error.code='SCHEMA_INCOMPATIBLE';error.status=409;error.recoverable=true;
  const response=errorResponse(error);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'SCHEMA_INCOMPATIBLE');
});
