require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBotService } = require('../src/application/bot-service.ts');

test('coordinator run and bridge tool diagnostics omit inputs and errors', async () => {
  const caps={readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false};
  const agent={id:'a',kind:'coordinator',status:'active',revision:1,contentSha256:'a'.repeat(64),name:'Coordinator',description:null,definition:{instructions:'role',capabilities:caps}};
  const snapshot={agentId:'a',kind:'coordinator',revision:1,contentSha256:agent.contentSha256,name:agent.name,description:null,botId:null,projectId:null,definition:agent.definition};
  const conversation={id:'conv-safe',botId:'b',coordinatorAgentId:'a',coordinatorAgentSnapshot:snapshot,nativeRef:null};
  const repository={get:table=>table==='bots'?{id:'b',status:'active',workingDirectory:'/private',maxParallelExecutions:1}:conversation,conversationConfiguration:()=>[],projectCalls:()=>[]};
  const lines=[],original=console.info; console.info=line=>lines.push(line);
  try {
    const service=createBotService({repository,workspace:{sessionDirectory:()=>'/private'},runtime:{run:async input=>{
      const bridge=input.tools.find(item=>item.name==='bot_start_project_call');
      await assert.rejects(()=>bridge.execute({projectId:'private-project',sourceEntryId:'private-source',sentContent:'secret prompt'}));
    }},runtimeInstanceId:'test',sessions:{},projects:{},memories:{},catalog:{getAgent:()=>agent}});
    assert.equal(service.send('b','conv-safe','private message','key').accepted,true);
    await new Promise(resolve=>setImmediate(resolve));
    const log=lines.join('\n');
    for(const stage of ['run_start','tool_start','tool_failed','run_returned']) assert.match(log,new RegExp(stage));
    assert.match(log,/NOT_FOUND/);
    assert.doesNotMatch(log,/private|secret|项目不在/);
  } finally {console.info=original;}
});
