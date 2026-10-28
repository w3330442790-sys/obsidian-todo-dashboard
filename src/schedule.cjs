'use strict';
const DIFFICULTIES={normal:{label:'一般',color:'#34976b'},medium:{label:'中等难度',color:'#c58a27'},high:{label:'较高难度',color:'#d35b62'}};
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const day=s=>Date.parse(s+'T00:00:00Z')/86400000;
const local=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function weekDates(date){const d=new Date(date+'T12:00:00'),offset=(d.getDay()+6)%7;d.setDate(d.getDate()-offset);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(x.getDate()+i);return local(x);});}
function taskOnDate(t,date){return !!t.date&&t.date<=date&&(t.endDate||t.date)>=date;}
function validateTaskSchedule(t){
 if(t.endDate&&(!dateOK(t.endDate)||!dateOK(t.date)||t.endDate<t.date))throw Error('结束日期需不早于计划日期');
 if(t.endDate&&t.endDate!==t.date&&t.repeat&&t.repeat!=='none')throw Error('范围日期任务暂不支持重复规则');
 if(t.difficulty&&!DIFFICULTIES[t.difficulty])throw Error('任务难度不合法');
 for(const k of ['startTime','endTime'])if(t[k]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t[k]))throw Error('任务时间不合法');
 if(t.startTime&&t.endTime&&t.endTime<=t.startTime)throw Error('结束时间需晚于开始时间');
}
function minutes(s){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s||''))return null;const[h,m]=s.split(':').map(Number);return h*60+m;}
function clipSegment(seg,date){const start=new Date(date+'T00:00:00'),next=new Date(start);next.setDate(next.getDate()+1);const a=Math.max(+start,seg.start),b=Math.min(+next,seg.end);if(b<=a)return null;const m=t=>{const d=new Date(t);return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;};return{start:a===+start?0:m(a),end:b===+next?1440:m(b)};}
function layoutIntervals(events){
 const sorted=events.map((e,index)=>({...e,index})).sort((a,b)=>a.start-b.start||a.end-b.end),out=[];let group=[],until=-1;
 function flush(){const ends=[];for(const e of group){let lane=ends.findIndex(x=>x<=e.start);if(lane<0)lane=ends.length;ends[lane]=e.end;e.lane=lane;}for(const e of group){e.lanes=ends.length;out.push(e);}group=[];}
 for(const e of sorted){if(e.start>=until){flush();until=-1;}group.push(e);until=Math.max(until,e.end);}flush();return out;
}
function validatePlan(p){
 if(!p||typeof p.id!=='string'||!p.id||typeof p.title!=='string'||!p.title.trim())throw Error('请输入计划名称');
 if(!['open','done'].includes(p.status))throw Error('计划状态不合法');
 if(!dateOK(p.startDate)||!dateOK(p.endDate)||p.endDate<p.startDate)throw Error('计划结束日期需不早于开始日期');
 if(!Array.isArray(p.goals))throw Error('子目标格式不合法');
 for(const g of p.goals)if(!g||typeof g.title!=='string'||!g.title.trim()||!['count','score'].includes(g.kind)||!Number.isFinite(g.target)||g.target<=0||!Number.isFinite(g.value)||g.value<0||g.value>g.target||g.kind==='score'&&g.target!==100)throw Error('子目标需有名称，当前值应在 0 与目标值之间；评分目标为 100');
 if(p.cover!=null&&typeof p.cover!=='string')throw Error('封面路径不合法');
}
function planProgress(p,today=local(new Date())){const span=day(p.endDate)-day(p.startDate),passed=day(today)-day(p.startDate),natural=Math.round(Math.max(0,Math.min(1,span===0?(passed>=0?1:0):passed/span))*100),goals=p.goals||[],actual=goals.length?Math.round(goals.reduce((n,g)=>n+Math.max(0,Math.min(1,g.value/g.target)),0)/goals.length*100+1e-9):0;return{actual,natural,delta:actual-natural,remaining:Math.max(0,day(p.endDate)-day(today))};}
module.exports={DIFFICULTIES,dateOK,weekDates,taskOnDate,validateTaskSchedule,minutes,clipSegment,layoutIntervals,validatePlan,planProgress};
