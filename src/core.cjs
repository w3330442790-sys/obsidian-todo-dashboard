'use strict';
const S=require('./schedule.cjs');
const QUADRANTS = {today:'今日处理',persist:'长期坚持',waiting:'等待推进',later:'以后再说'};
const PALETTE=['#149e9a','#6488d8','#a47bd2','#d58c48','#d3708c','#73a46d','#b79749','#6e9da8'];
const pad=n=>String(n).padStart(2,'0');
const localDate=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function parseDate(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);}
function addDays(s,n){const d=parseDate(s);d.setDate(d.getDate()+n);return localDate(d);}
function uid(){return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
function nextOccurrence(task,after){
 if(task.status!=='done'||!task.date||!task.repeat||task.repeat==='none')return null;
 let next=task.date;
 const anchor=task.repeatAnchor||Number(task.date.slice(8));
 if(task.repeat==='monthly'){
  let d=parseDate(task.date);
  do {d=new Date(d.getFullYear(),d.getMonth()+1,1);next=localDate(new Date(d.getFullYear(),d.getMonth(),Math.min(anchor,new Date(d.getFullYear(),d.getMonth()+1,0).getDate())));} while(next<=after);
 }else if(['daily','weekly'].includes(task.repeat)){
  const step=task.repeat==='weekly'?7:1;
  do{next=addDays(next,step);}while(next<=after);
 }else return null;
 const series=task.seriesId||task.id;
 return {...task,id:`${series}__${next}`,seriesId:series,date:next,...(task.endDate?{endDate:next}:{}),repeatAnchor:anchor,status:'open',completedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),subtasks:(task.subtasks||[]).map(s=>({...s,done:false}))};
}
function completeTask(task,date=localDate()){
 if(task.status==='done')return {task,next:null};
 const done={...task,status:'done',completedAt:date,repeatIssued:false,updatedAt:new Date().toISOString()};
 return {task:done,next:nextOccurrence(done,date)};
}
function elapsed(timer,now=Date.now()){return Math.max(0,(timer.accumulated||0)+(timer.runningSince==null?0:now-timer.runningSince));}
function dailyDuration(session,date){
 const start=parseDate(date).getTime(),end=parseDate(addDays(date,1)).getTime();
 return (session.segments||[]).reduce((n,s)=>n+Math.max(0,Math.min(end,s.end)-Math.max(start,s.start)),0);
}
function duration(ms){const s=Math.floor(Math.max(0,ms)/1000);return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`;}
function encodeRecord(kind,record){
 const title=String(record.title||kind).replace(/[\r\n]/g,' ');
 return `---\ntodo_schema: 1\ntodo_kind: ${kind}\ntodo_record: ${JSON.stringify(record)}\n---\n\n# ${title}\n\n${record.description||''}\n\n${(record.subtasks||[]).map(s=>`- [${s.done?'x':' '}] ${s.title}`).join('\n')}\n\n<!-- 结构数据由 Todo 工作台维护；请在插件界面编辑。 -->\n`;
}
function decodeRecord(text,kind){
 const header=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
 if(!header||!/^todo_schema: 1\s*$/m.test(header))throw Error('不支持的数据版本');
 if(!header.split(/\r?\n/).includes(`todo_kind: ${kind}`))throw Error('记录类型不匹配');
 const value=JSON.parse(/^todo_record: (.+)$/m.exec(header)?.[1]||'null');
 if(!value||typeof value!=='object')throw Error('数据损坏');
 if(kind!=='settings'&&(!value.id||typeof value.id!=='string'))throw Error('记录缺少 ID');
 if(kind==='task'&&(typeof value.title!=='string'||!['open','done'].includes(value.status)))throw Error('任务格式不正确');
 if(kind==='task'){
  S.validateTaskSchedule(value);
  if(value.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||localDate(parseDate(value.date))!==value.date))throw Error('任务日期不合法');
  if(value.completedAt&&(!/^\d{4}-\d{2}-\d{2}$/.test(value.completedAt)||localDate(parseDate(value.completedAt))!==value.completedAt))throw Error('完成日期不合法');
  if(value.repeatAnchor!=null&&(!Number.isInteger(value.repeatAnchor)||value.repeatAnchor<1||value.repeatAnchor>31))throw Error('重复日期号不合法');
  if(value.repeat&&!['none','daily','weekly','monthly'].includes(value.repeat))throw Error('不支持的重复规则');
  if(value.quadrant&&!QUADRANTS[value.quadrant])throw Error('任务象限不合法');
  if(value.subtasks!=null&&(!Array.isArray(value.subtasks)||value.subtasks.some(s=>!s||typeof s.title!=='string'||typeof s.done!=='boolean')))throw Error('子任务数据损坏');
 }
 if(kind==='session'&&(!Array.isArray(value.segments)||value.segments.some(s=>!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<s.start)))throw Error('专注时间区间损坏');
 if(kind==='settings'){
  for(const k of ['lists','stats','excludedFolders'])if(value[k]!=null&&!Array.isArray(value[k]))throw Error('设置格式损坏：'+k);
  if((value.lists||[]).some(l=>!l||typeof l.name!=='string'||typeof l.id!=='string'||!/^#[0-9a-f]{6}$/i.test(l.color)))throw Error('清单格式损坏');
  if((value.stats||[]).some(s=>!s||!['folder','tag'].includes(s.kind)||typeof s.value!=='string'))throw Error('统计配置损坏');
  if((value.excludedFolders||[]).some(x=>typeof x!=='string'))throw Error('排除路径格式损坏');
 }
 if(kind==='plan')S.validatePlan(value);
 return value;
}
function matchesNote(path,tags,filter){
 const v=String(filter.value||'').trim().replace(/^\/+|\/+$/g,'');
 if(filter.kind==='tag')return tags.includes(v.startsWith('#')?v:'#'+v);
 return path.startsWith(v+'/');
}
module.exports={...S,QUADRANTS,PALETTE,localDate,parseDate,addDays,uid,nextOccurrence,completeTask,elapsed,dailyDuration,duration,encodeRecord,decodeRecord,matchesNote};
