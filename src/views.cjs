'use strict';
const C=require('./core.cjs');
function el(parent,tag,cls,text){const e=parent.ownerDocument.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;parent.appendChild(e);return e;}
function button(parent,text,action,cls=''){const b=el(parent,'button','td-button '+cls,text);b.type='button';b.addEventListener('click',action);return b;}
function select(parent,options,value,change){const s=el(parent,'select','td-select');for(const [v,label]of options){const o=el(s,'option','',label);o.value=v;}s.value=value;s.addEventListener('change',()=>change(s.value));return s;}
function empty(parent,text){el(parent,'div','td-empty',text);}
function heading(parent,kicker,title,detail){const h=el(parent,'div','td-section-heading');if(kicker)el(h,'div','td-eyebrow',kicker);el(h,'h2','',title);if(detail)el(h,'p','td-muted',detail);return h;}
function panel(parent,title,action){const p=el(parent,'section','td-panel');const h=el(p,'div','td-panel-heading');el(h,'h3','',title);if(action)action(h);return p;}
const pageNames={home:'首页',today:'今日待办',calendar:'日程概览',timeline:'时间轴',quadrants:'四象限',inbox:'待办箱',lists:'分类清单',trash:'回收站'};
function sortTasks(tasks){return [...tasks].sort((a,b)=>(a.status==='done')-(b.status==='done')||(a.date||'9999').localeCompare(b.date||'9999')||(a.startTime||'').localeCompare(b.startTime||'')||a.title.localeCompare(b.title));}
function filtered(view,tasks){const s=view.state;return sortTasks(tasks.filter(t=>!t.deleted&&(!s.list||t.listId===s.list)&&(s.showDone||t.status!=='done')&&(!s.query||t.title.toLowerCase().includes(s.query.toLowerCase()))));}
function taskRow(view,parent,t){
 const p=view.plugin,row=el(parent,'div','td-task'+(t.status==='done'?' is-done':''));
 const check=el(row,'input','td-check');check.type='checkbox';check.checked=t.status==='done';check.setAttribute('aria-label','完成 '+t.title);check.addEventListener('change',()=>p.run(()=>p.toggleTask(t)));
 const content=button(row,'',()=>p.editTask(t),'td-task-content');el(content,'span','td-task-title',t.title);
 const meta=el(content,'span','td-task-meta');const list=p.list(t.listId);if(list){const dot=el(meta,'span','td-dot');dot.style.background=list.color;el(meta,'span','',list.name);}
 if(t.date){const overdue=t.status!=='done'&&t.date<C.localDate();el(meta,'span',overdue?'td-overdue':'',`${overdue?'逾期 · ':''}${t.date}${t.startTime?' '+t.startTime:''}${t.endTime?'–'+t.endTime:''}`);}
 const subs=t.subtasks||[];if(subs.length)el(meta,'span','',`${subs.filter(x=>x.done).length}/${subs.length} 步骤`);
 if(t.repeat&&t.repeat!=='none')el(meta,'span','',({daily:'每天',weekly:'每周',monthly:'每月'})[t.repeat]);
 const b=button(row,'▶',()=>p.run(()=>p.startTimer(t)),'td-icon-button');b.setAttribute('aria-label','为 '+t.title+' 开始计时');
 return row;
}
function taskList(view,parent,tasks,message='这里暂时没有任务'){if(!tasks.length)return empty(parent,message);for(const t of tasks)taskRow(view,parent,t);}
function focusBar(view,parent){
 const p=view.plugin,box=el(parent,'section','td-focus'),left=el(box,'div','');el(left,'div','td-eyebrow','FOCUS / 专注');
 el(left,'div','td-focus-title',p.timer?.title||'留一段时间，专注当下');const time=el(box,'div','td-clock',C.duration(p.timer?C.elapsed(p.timer):0));time.dataset.timer='true';
 const actions=el(box,'div','td-focus-actions');
 if(!p.timer)button(actions,'开始计时',()=>p.run(()=>p.startTimer(null)),'mod-cta');
 else{
  button(actions,p.timer.runningSince==null?'继续':'暂停',()=>p.run(()=>p.toggleTimer())).disabled=!!p.finishing;
  button(actions,p.finishing?'保存中…':'结束并保存',()=>p.run(()=>p.finishTimer()),'mod-cta').disabled=!!p.finishing;
 }
 el(box,'div','td-focus-caption','正计时 · 不设轮次 · 暂停不累计');
}
function home(view,parent){
 const p=view.plugin,today=C.localDate(),all=[...p.store.tasks.values()].filter(t=>!t.deleted),tasks=sortTasks(all.filter(t=>t.date===today));
 const overdue=all.filter(t=>t.date&&t.date<today&&t.status==='open');
 const top=el(parent,'div','td-greeting');heading(top,'YOUR DAY, AT A GLANCE','把今天，安排得从容一点。',new Intl.DateTimeFormat('zh-CN',{dateStyle:'full'}).format(new Date()));
 button(top,'进入待办工作台 ↗',()=>view.go('today'),'mod-cta');
 const stats=el(parent,'div','td-stats');
 const notes=p.notes(),weekStart=C.addDays(today,-((new Date().getDay()+6)%7));
 const dayMs=[...p.store.sessions.values()].reduce((n,s)=>n+C.dailyDuration(s,today),0);
 let weekMs=0;for(let d=weekStart;d<=today;d=C.addDays(d,1))weekMs+=[...p.store.sessions.values()].reduce((n,s)=>n+C.dailyDuration(s,d),0);
 const metrics=[['今日任务',tasks.length,`${tasks.filter(t=>t.status==='done').length} 项已完成`],['逾期待处理',overdue.length,'打开今日页查看',()=>view.go('today')],['今日专注',`${Math.floor(dayMs/60000)} 分钟`,`本周 ${Math.floor(weekMs/60000)} 分钟`],['笔记库',notes.length,'近 7 天：新增 '+notes.filter(f=>f.stat.ctime>=Date.now()-7*86400000).length+' / 修改 '+notes.filter(f=>f.stat.mtime>=Date.now()-7*86400000).length]];
 for(const [label,value,detail,action]of metrics){const card=el(stats,'div','td-stat');el(card,'div','td-muted',label);el(card,'strong','',value);if(action)button(card,detail,action,'td-link');else el(card,'small','td-muted',detail);}
 focusBar(view,parent);
 const grid=el(parent,'div','td-home-grid'),todo=panel(grid,'今日待办',h=>button(h,'＋ 新建',()=>p.editTask(null,{date:today}),'td-link'));
 taskList(view,todo,tasks,'今天还没有安排，写下第一件想做的事。');
 if(overdue.length)button(todo,`${overdue.length} 项逾期，点击处理 →`,()=>view.go('today'),'td-overdue td-link');
 const recent=panel(grid,'最近笔记',h=>select(h,[['modified','最近修改'],['created','最近创建']],p.store.settings.recentSort||'modified',v=>p.run(()=>p.updateSettings({recentSort:v}))));
 const exclude=p.store.settings.excludedFolders||[];
 const recentNotes=notes.filter(f=>!exclude.some(x=>f.path.startsWith(x+'/'))).sort((a,b)=>(p.store.settings.recentSort==='created'?b.stat.ctime-a.stat.ctime:b.stat.mtime-a.stat.mtime)).slice(0,8);
 if(!recentNotes.length)empty(recent,'笔记会显示在这里');
 for(const f of recentNotes){const b=button(recent,'',()=>p.app.workspace.openLinkText(f.path,'',false),'td-note');el(b,'span','',f.basename||f.path.split('/').pop().replace(/\.md$/,''));el(b,'small','td-muted',f.path);}
 const custom=panel(parent,'我的笔记统计',h=>button(h,'＋ 添加统计',()=>p.editStat(),'td-link'));
 const cards=el(custom,'div','td-custom-stats');
 if(!(p.store.settings.stats||[]).length)empty(cards,'添加文件夹或标签，观察知识积累。');
 for(const stat of p.store.settings.stats||[]){const matches=notes.filter(f=>C.matchesNote(f.path,p.noteTags(f),stat));const card=el(cards,'div','td-custom-stat');button(card,`${stat.kind==='tag'?'#':'▱'} ${stat.value}`,()=>p.showNotes(stat.value,matches),'td-link');el(card,'strong','',matches.length);button(card,'移除',()=>p.run(()=>p.updateSettings({stats:p.store.settings.stats.filter(x=>x.id!==stat.id)})),'td-small td-muted');}
}
function calendar(view,parent){
 const p=view.plugin,s=view.state,month=C.parseDate(s.month+'-01');const nav=el(parent,'div','td-calendar-nav');button(nav,'‹ 上月',()=>{view.state.month=C.localDate(new Date(month.getFullYear(),month.getMonth()-1,1)).slice(0,7);view.render();});
 el(nav,'h3','',`${month.getFullYear()} 年 ${month.getMonth()+1} 月`);button(nav,'下月 ›',()=>{s.month=C.localDate(new Date(month.getFullYear(),month.getMonth()+1,1)).slice(0,7);view.render();});button(nav,'今天',()=>{s.month=C.localDate().slice(0,7);s.selectedDate=C.localDate();view.render();},'td-link');
 const grid=el(parent,'div','td-calendar');for(const d of ['周一','周二','周三','周四','周五','周六','周日'])el(grid,'div','td-weekday',d);
 const start=C.addDays(s.month+'-01',-((month.getDay()+6)%7));const tasks=filtered(view,[...p.store.tasks.values()]);
 for(let i=0;i<42;i++){
  const date=C.addDays(start,i),cell=el(grid,'div','td-day'+(date.slice(0,7)!==s.month?' is-outside':'')+(date===C.localDate()?' is-today':'')+(date===s.selectedDate?' is-selected':''));
  const b=button(cell,String(Number(date.slice(8))),()=>{s.selectedDate=date;view.render();},'td-day-number');b.setAttribute('aria-label',date+' 查看日程');
  const entries=tasks.filter(t=>t.date===date);
  for(const t of entries.slice(0,3)){const tb=button(cell,t.title,()=>p.editTask(t),'td-calendar-task'+(t.status==='done'?' is-done':''));tb.style.setProperty('--task-color',p.list(t.listId)?.color||'#149e9a');tb.title=t.title;}
  if(entries.length>3)button(cell,`+${entries.length-3} 更多`,()=>{s.selectedDate=date;view.render();},'td-more');
 }
 const detail=panel(parent,`${s.selectedDate} 的安排`,h=>button(h,'＋ 添加任务',()=>p.editTask(null,{date:s.selectedDate}),'td-link'));
 taskList(view,detail,tasks.filter(t=>t.date===s.selectedDate),'当天没有安排');
}
function timeline(view,parent){
 const p=view.plugin,date=view.state.timelineDate;const nav=el(parent,'div','td-calendar-nav');button(nav,'‹ 前一天',()=>{view.state.timelineDate=C.addDays(date,-1);view.render();});const input=el(nav,'input','td-input');input.type='date';input.value=date;input.addEventListener('change',()=>{if(input.value){view.state.timelineDate=input.value;view.render();}});button(nav,'后一天 ›',()=>{view.state.timelineDate=C.addDays(date,1);view.render();});
 const grid=el(parent,'div','td-timeline-grid'),planned=panel(grid,'计划安排'),actual=panel(grid,'实际专注');
 taskList(view,planned,filtered(view,[...p.store.tasks.values()]).filter(t=>t.date===date));
 const sessions=[...p.store.sessions.values()].filter(s=>C.dailyDuration(s,date)>0).sort((a,b)=>a.segments[0].start-b.segments[0].start);
 if(!sessions.length)empty(actual,'当天没有专注记录');
 for(const session of sessions){const row=el(actual,'div','td-session');el(row,'div','td-session-title',session.title||'自由专注');el(row,'strong','',C.duration(C.dailyDuration(session,date)));
  for(const seg of session.segments){if(seg.end<=C.parseDate(date).getTime()||seg.start>=C.parseDate(C.addDays(date,1)).getTime())continue;el(row,'small','td-muted',`${new Date(seg.start).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} → ${new Date(seg.end).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}${C.localDate(new Date(seg.start))!==C.localDate(new Date(seg.end))?' · 跨日':''}`);}
  if(session.taskId){const t=p.store.tasks.get(session.taskId);if(t)button(row,'查看任务',()=>p.editTask(t),'td-link');}
 }
}
function workspace(view,parent){
 const p=view.plugin,s=view.state;
 const h=el(parent,'div','td-work-heading');heading(h,'PLAN / DO / REFLECT',pageNames[s.page],s.page==='quadrants'?'象限决定归属，日期决定今天。':'让安排与实际投入，清晰可见。');button(h,'＋ 新建任务',()=>p.editTask(null,{date:s.page==='today'?C.localDate():''}),'mod-cta');
 const toolbar=el(parent,'div','td-toolbar');
 select(toolbar,[['','全部清单'],...(p.store.settings.lists||[]).map(l=>[l.id,l.name])],s.list,v=>{s.list=v;view.render();});
 const search=el(toolbar,'input','td-input');search.placeholder='搜索任务…';search.value=s.query;search.setAttribute('aria-label','搜索任务');search.addEventListener('change',()=>{s.query=search.value;view.render();});
 const label=el(toolbar,'label','td-toggle'),check=el(label,'input','');check.type='checkbox';check.checked=s.showDone;el(label,'span','','显示已完成');check.addEventListener('change',()=>{s.showDone=check.checked;view.render();});
 if(s.page==='calendar')return calendar(view,parent);
 if(s.page==='timeline')return timeline(view,parent);
 const all=[...p.store.tasks.values()],tasks=filtered(view,all);
 if(s.page==='today'){
  const today=C.localDate();taskList(view,panel(parent,'今天'),tasks.filter(t=>t.date===today));
  const late=tasks.filter(t=>t.date&&t.date<today&&t.status==='open');if(late.length)taskList(view,panel(parent,`逾期 · ${late.length}`),late);
 }else if(s.page==='inbox')taskList(view,panel(parent,'未安排日期'),tasks.filter(t=>!t.date));
 else if(s.page==='quadrants'){
  const grid=el(parent,'div','td-quadrants');for(const [key,name]of Object.entries(C.QUADRANTS)){const box=panel(grid,name,h=>button(h,'＋',()=>p.editTask(null,{quadrant:key}),'td-link'));box.classList.add('td-q-'+key);taskList(view,box,tasks.filter(t=>t.quadrant===key));}
 }else if(s.page==='lists'){
  button(parent,'＋ 创建清单',()=>p.editList(),'td-link');
  for(const list of [{id:'',name:'未分类',color:'#149e9a'},...(p.store.settings.lists||[])]){const box=panel(parent,list.name,h=>{if(list.id)button(h,'编辑颜色 / 名称',()=>p.editList(list),'td-link');button(h,'＋ 任务',()=>p.editTask(null,{listId:list.id}),'td-link');});box.style.setProperty('--task-color',list.color);taskList(view,box,tasks.filter(t=>(t.listId||'')===list.id));}
 }else if(s.page==='trash'){
  const deleted=all.filter(t=>t.deleted);if(!deleted.length)empty(parent,'回收站是空的');for(const t of deleted){const row=el(parent,'div','td-task');el(row,'span','td-grow',t.title);button(row,'恢复',()=>p.run(()=>p.saveTask({...t,deleted:false})),'td-link');}
 }
}
function render(view){
 const p=view.plugin,host=view.contentEl;host.replaceChildren();host.classList.add('td-host');const root=el(host,'div','td-shell');
 const aside=el(root,'aside','td-sidebar');el(aside,'div','td-brand','○  从容');el(aside,'div','td-brand-sub','TODO WORKSPACE');
 const nav=el(aside,'nav','td-navigation');for(const [key,name]of Object.entries(pageNames))button(nav,name,()=>view.go(key),'td-nav'+(key===view.state.page?' is-active':''));
 const footer=el(aside,'div','td-sidebar-footer');el(footer,'span','td-muted','数据保存在笔记库');button(footer,'刷新数据',()=>p.run(()=>p.reload()),'td-link');button(footer,'偏好设置',()=>p.preferences(),'td-link');
 const main=el(root,'main','td-main');if(p.store.errors.length){const banner=el(main,'div','td-warning');el(banner,'span','',`${p.store.errors.length} 个数据文件需要检查，原文件已保留。`);button(banner,'查看详情',()=>p.showErrors(),'td-link');}
 if(view.state.page==='home')home(view,main);else{workspace(view,main);focusBar(view,main);}
}
module.exports={el,button,select,empty,heading,panel,render,pageNames};
