'use strict';
class GenerationRunner{
 constructor(options){this.options=options;this.running=false;}
 async run(prompt,{images=[],signal}={}){
  if(this.running)throw Error('请先等待当前生成完成');if(signal?.aborted)throw Error('生成已取消');this.running=true;
  let client,threadId=null,settled=false,timer,abort,closed=false;const close=()=>{if(!closed&&client){closed=true;client.close();}};const messages=new Map();let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});done.catch(()=>{});
  const finish=(error)=>{if(settled)return;settled=true;if(error)reject(error);else{const text=String([...messages.values()].at(-1)||'').trim();text?resolve(text):reject(Error('Codex 未返回可用草稿，请检查资料是否可读'));}};
  try{
   const factory=this.options.clientFactory||((o)=>{const{CodexClient}=require('./codex-client.cjs');return new CodexClient(o);});
   client=factory({...this.options,onApproval:async()=>undefined,onEvent:event=>{const p=event.params||{};if(p.threadId&&p.threadId!==threadId)return;if(event.method==='item/agentMessage/delta'){const id=p.itemId||'answer';messages.set(id,(messages.get(id)||'')+(p.delta||''));if([...messages.values()].join('').length>2000000)finish(Error('草稿过长，请缩小范围'));}else if(event.method==='item/completed'&&p.item?.type==='agentMessage')messages.set(p.item.id||'answer',p.item.text||messages.get(p.item.id)||'');else if(event.method==='turn/completed'){if(p.turn?.status!=='completed')finish(Error(p.turn?.error?.message||'生成未完成或已取消'));else finish();}else if(event.method==='client/disconnected')finish(Error('Codex 连接已断开'));else if(event.method==='error'&&!p.willRetry)finish(Error(p.error?.message||'Codex 生成失败'));}});
   abort=()=>{finish(Error('生成已取消'));close();};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{finish(Error('生成超时，请缩小资料范围后重试'));close();},this.options.timeoutMs||600000);
   await client.connect();if(signal?.aborted)throw Error('生成已取消');const account=await client.readAccount();if(!account.account)throw Error('请先在 Codex 助手登录');const result=await client.startThread({mode:'readOnly',model:this.options.model||undefined});threadId=result.thread.id;
   if(signal?.aborted)throw Error('生成已取消');await client.send(prompt,{threadId,mode:'readOnly',model:this.options.model||undefined,images});return await done;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);close();this.running=false;}
 }
}
module.exports={GenerationRunner};
