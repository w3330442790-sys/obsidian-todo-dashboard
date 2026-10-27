'use strict';
const fs=require('node:fs'),path=require('node:path');const{CodexClient}=require('../src/codex-client.cjs');
(async()=>{const executable=process.argv[2],cwd=path.resolve(__dirname,'../artifacts/codex-test-vault');fs.mkdirSync(cwd,{recursive:true});fs.writeFileSync(path.join(cwd,'验证笔记.md'),'# 隔离测试\n\n校验码：SCENERY-DEMO-42\n');let answer='',finish,fail;
 const done=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
 const client=new CodexClient({executable,cwd,onEvent:e=>{if(e.method==='item/agentMessage/delta')answer+=e.params.delta||'';if(e.method==='turn/completed'){if(e.params.turn?.status==='failed')fail(Error(e.params.turn.error?.message||'turn failed'));else finish();}if(e.method==='client/disconnected')fail(Error('disconnected'));}});
 const timeout=setTimeout(()=>fail(Error('read-only test timeout')),120000);
 try{await client.connect();const account=await client.readAccount();if(!account.account)throw Error('not logged in');const thread=await client.startThread({mode:'readOnly'});await client.send('请读取当前目录中的 验证笔记.md，输出该文件中的校验码。只读，不修改任何文件。',{threadId:thread.thread.id,mode:'readOnly'});await done;if(!answer.includes('SCENERY-DEMO-42'))throw Error('Model did not return the file verification code');console.log(JSON.stringify({connected:true,readOnlyFileQuery:true,verificationCodeMatched:true,scope:'isolated test vault only'}));}
 finally{clearTimeout(timeout);client.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
