'use strict';
const C=require('./core.cjs');
function legend(parent,{el}){const box=el(parent,'div','td-difficulty-legend');for(const v of Object.values(C.DIFFICULTIES)){const item=el(box,'span','',v.label);item.style.setProperty('--task-color',v.color);}}
function renderTimeline(view,parent,ui,tasks){
 const {el,button,select}=ui,p=view.plugin,s=view.state,date=s.timelineDate||C.localDate(),week=C.weekDates(date),mode=s.timelineMode||'day',scale=s.timelineScale||48;
 const nav=el(parent,'div','td-calendar-nav');button(nav,mode==='week'?'‹ 前一周':'‹ 前一天',()=>{s.timelineDate=C.addDays(date,mode==='week'?-7:-1);view.render();});
 const input=el(nav,'input','td-input');input.type='date';input.value=date;input.setAttribute('aria-label','时间轴日期');input.onchange=()=>{if(input.value){s.timelineDate=input.value;view.render();}};
 button(nav,mode==='week'?'后一周 ›':'后一天 ›',()=>{s.timelineDate=C.addDays(date,mode==='week'?7:1);view.render();});button(nav,'今天',()=>{s.timelineDate=C.localDate();view.render();});
 for(const[k,label]of [['day','日视图'],['week','周视图']])button(nav,label,()=>{s.timelineMode=k;view.render();},mode===k?'is-active':'');
 select(nav,[['32','紧凑刻度'],['48','标准刻度'],['72','宽松刻度']],String(scale),v=>{s.timelineScale=Number(v);view.render();}).setAttribute('aria-label','时间轴刻度');legend(parent,ui);
 const strip=el(parent,'div','td-week-strip');for(let i=0;i<7;i++){const b=button(strip,'',()=>{s.timelineDate=week[i];view.render();},'td-week-date'+(week[i]===date?' is-active':''));el(b,'small','','周'+'一二三四五六日'[i]);el(b,'strong','',week[i].slice(5).replace('-','/'));if(week[i]===C.localDate())el(b,'small','','今天');}
 const days=mode==='week'?week:[date],top=el(parent,'div','td-unscheduled');el(top,'h4','','全天 / 待安排');let count=0;
 for(const d of days){const entries=tasks.filter(t=>C.taskOnDate(t,d)&&(!t.startTime||!t.endTime||t.endDate&&t.endDate!==t.date));if(!entries.length)continue;const row=el(top,'div','td-unscheduled-day');el(row,'small','td-muted',d);for(const t of entries){count++;const b=button(row,t.title,()=>p.editTask(t),'td-calendar-task');b.style.setProperty('--task-color',C.DIFFICULTIES[t.difficulty||'normal'].color);}}
 if(!count)el(top,'small','td-muted','暂无全天或待安排事项');
 const scroll=el(parent,'div','td-time-scroll');scroll.setAttribute('aria-label','24小时时间轴');const canvas=el(scroll,'div','td-time-canvas '+(mode==='week'?'is-week':'is-day'));canvas.style.setProperty('--hour-height',scale+'px');
 const cols=mode==='week'?days.map(d=>({date:d,label:d.slice(5),type:'both'})):[{date,label:'计划事项',type:'task'},{date,label:'实际专注',type:'session'}];
 const headers=el(canvas,'div','td-time-headers');headers.style.gridTemplateColumns=`48px repeat(${cols.length},minmax(0,1fr))`;el(headers,'span','','时间');for(const col of cols)el(headers,'strong','',col.label);
 const body=el(canvas,'div','td-time-body');body.style.height=scale*24+'px';const ruler=el(body,'div','td-time-ruler');for(let hour=0;hour<=24;hour++){const label=el(ruler,'span','',`${hour}:00`);label.style.top=hour*scale+'px';}
 const columns=el(body,'div','td-time-columns');columns.style.gridTemplateColumns=`repeat(${cols.length},minmax(0,1fr))`;
 for(const col of cols){const column=el(columns,'div','td-time-column');column.setAttribute('aria-label',col.date+' '+col.label);column.addEventListener('dblclick',e=>{if(e.target!==column)return;const m=Math.max(0,Math.min(1425,Math.floor((e.clientY-column.getBoundingClientRect().top)/scale*4)*15));p.editTask(null,{date:col.date,startTime:time(m),endTime:time(Math.min(m+30,1439))});});
  const events=[];
  if(col.type!=='session')for(const t of tasks){if(!C.taskOnDate(t,col.date)||t.endDate&&t.endDate!==t.date)continue;const a=C.minutes(t.startTime),b=C.minutes(t.endTime);if(a!=null&&b>a)events.push({start:a,end:b,title:t.title,task:t,color:C.DIFFICULTIES[t.difficulty||'normal'].color,kind:'计划'});}
  if(col.type!=='task')for(const session of p.store.sessions.values())for(const seg of session.segments||[]){const clipped=C.clipSegment(seg,col.date);if(clipped)events.push({...clipped,title:session.title||'自由专注',task:p.store.tasks.get(session.taskId),color:'#728ac5',kind:'专注'});}
  for(const event of C.layoutIntervals(events)){const b=button(column,'',()=>event.task?p.editTask(event.task):showSession(p,event,ui),'td-time-event');b.style.top=event.start/60*scale+'px';b.style.height=Math.max(5,(event.end-event.start)/60*scale)+'px';b.style.left=`${event.lane/event.lanes*100}%`;b.style.width=`calc(${100/event.lanes}% - 3px)`;b.style.setProperty('--task-color',event.color);b.title=`${event.title} · ${event.kind} ${time(event.start)}–${time(event.end)}`;el(b,'strong','',event.title);el(b,'small','',`${event.kind} ${time(event.start)}–${time(event.end)}`);}
  if(col.date===C.localDate()){const now=new Date(),line=el(column,'div','td-now-line');line.dataset.nowLine='true';line.dataset.hourHeight=String(scale);line.style.top=(now.getHours()+now.getMinutes()/60)*scale+'px';}
 }
 el(parent,'p','td-muted td-small','双击空白时段添加任务；点击卡片编辑。蓝色为实际专注，跨日记录按当天边界显示。');
 if(s.timelineScrollKey===`${date}/${mode}/${scale}`)scroll.scrollTop=s.timelineScrollTop||0;else{scroll.scrollTop=7*scale;s.timelineScrollKey=`${date}/${mode}/${scale}`;}scroll.addEventListener('scroll',()=>{s.timelineScrollTop=scroll.scrollTop;});
}
function showSession(p,event,{el,button}){const {Modal}=require('obsidian');class Details extends Modal{onOpen(){el(this.contentEl,'h3','',event.title);el(this.contentEl,'p','',`实际专注 ${time(event.start)}–${time(event.end)}`);button(this.contentEl,'关闭',()=>this.close());}}new Details(p.app).open();}
function time(m){return`${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.floor(m%60)).padStart(2,'0')}`;}
module.exports={renderTimeline,legend};
