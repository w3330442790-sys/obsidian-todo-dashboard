'use strict';
const C=require('./core.cjs');
const D=require('./dashboard.cjs');
const G=require('./global-theme.cjs');
const scenery=require('../assets/scenery/credits.json');
const S=require('./schedule-view.cjs'),P=require('./plans-view.cjs');
const A=require('./assistant.cjs');const R=require('./reflection.cjs');const J=require('./journal-view.cjs');const H=require('./home-summary.cjs');
const illustrations=scenery.filter(entry=>entry.mode&&entry.src);
const themeArtwork=(mode,color,date=C.localDate())=>D.themeIllustration(illustrations,date,mode,color);
const scenerySource=(gallery,hasPhotos)=>gallery.source||((gallery.folder||hasPhotos)?'photos':'illustrations');
function el(parent,tag,cls,text){const e=parent.ownerDocument.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;parent.appendChild(e);return e;}
function withIcon(label,icon){
 if(icon){const mark=el(label,'span','td-label-icon',icon);mark.setAttribute('aria-hidden','true');label.prepend(mark);}
 return label;
}
function button(parent,text,action,cls='',icon){const b=withIcon(el(parent,'button','td-button '+cls,text),icon);b.type='button';b.addEventListener('click',action);return b;}
function select(parent,options,value,change){const s=el(parent,'select','td-select');for(const [v,label]of options){const o=el(s,'option','',label);o.value=v;}s.value=value;s.addEventListener('change',()=>change(s.value));return s;}
function empty(parent,text){el(parent,'div','td-empty',text);}
function heading(parent,kicker,title,detail,icon){const h=el(parent,'div','td-section-heading');if(kicker)el(h,'div','td-eyebrow',kicker);withIcon(el(h,'h2','',title),icon);if(detail)el(h,'p','td-muted',detail);return h;}
function panel(parent,title,action,icon){const p=el(parent,'section','td-panel');const h=el(p,'div','td-panel-heading');withIcon(el(h,'h3','',title),icon);if(action)action(h);return p;}
const pageNames={journal:'灵感与复盘',courses:'课程整理',plans:'计划',home:'首页',today:'今日待办',calendar:'日程概览',timeline:'时间轴',quadrants:'四象限',inbox:'待办箱',lists:'分类清单',assistant:'Codex 助手',trash:'回收站'};
const pageIcons={home:'🏡',today:'📝',calendar:'📅',quadrants:'🧩',timeline:'🕰️',plans:'🎯',inbox:'📥',lists:'🗂️',trash:'🗑️',journal:'💡',courses:'📚',assistant:'🤖'};
function sortTasks(tasks){return [...tasks].sort((a,b)=>(a.status==='done')-(b.status==='done')||(a.date||'9999').localeCompare(b.date||'9999')||(a.startTime||'').localeCompare(b.startTime||'')||a.title.localeCompare(b.title));}
function isOverdue(task,today){return task.status==='open'&&task.date&&(task.endDate||task.date)<today;}
function filtered(view,tasks){const s=view.state;return sortTasks(tasks.filter(t=>!t.deleted&&(!s.list||t.listId===s.list)&&(s.showDone||t.status!=='done')&&(!s.query||t.title.toLowerCase().includes(s.query.toLowerCase()))));}
function taskRow(view,parent,t){
 const p=view.plugin,row=el(parent,'div','td-task'+(t.status==='done'?' is-done':''));
 const check=el(row,'input','td-check');check.type='checkbox';check.checked=t.status==='done';check.setAttribute('aria-label','完成 '+t.title);check.addEventListener('change',()=>p.run(()=>p.toggleTask(t)));
 const content=button(row,'',()=>p.editTask(t),'td-task-content');el(content,'span','td-task-title',t.title);
 const meta=el(content,'span','td-task-meta');const list=p.list(t.listId);if(list){const dot=el(meta,'span','td-dot');dot.style.background=list.color;el(meta,'span','',list.name);}
 const difficulty=C.DIFFICULTIES[t.difficulty||'normal'];const badge=el(meta,'span','td-difficulty-badge',difficulty.label);badge.style.color=difficulty.color;
 if(t.date){const overdue=t.status!=='done'&&(t.endDate||t.date)<C.localDate();el(meta,'span',overdue?'td-overdue':'',`${overdue?'逾期 · ':''}${t.date}${t.endDate&&t.endDate!==t.date?' 至 '+t.endDate:''}${t.startTime?' '+t.startTime:''}${t.endTime?'–'+t.endTime:''}`);}
 const subs=t.subtasks||[];if(subs.length)el(meta,'span','',`${subs.filter(x=>x.done).length}/${subs.length} 步骤`);
 if(t.repeat&&t.repeat!=='none')el(meta,'span','',({daily:'每天',weekly:'每周',monthly:'每月'})[t.repeat]);
 const b=button(row,'▶',()=>p.run(()=>p.startTimer(t)),'td-icon-button');b.setAttribute('aria-label','为 '+t.title+' 开始计时');
 return row;
}
function taskList(view,parent,tasks,message='这里暂时没有任务'){if(!tasks.length)return empty(parent,message);for(const t of tasks)taskRow(view,parent,t);}
function overdueList(view,parent,tasks){
 const p=view.plugin,box=panel(parent,`逾期待处理 · ${tasks.length}`,null,'⏳');
 if(!tasks.length){view.state.overdueSelection?.clear();return empty(box,'没有符合条件的逾期任务');}
 const selected=view.state.overdueSelection??=new Set();
 const entries=tasks.map(task=>({task,token:p.store.token('task',task.id)}));
 const eligible=new Set(tasks.filter(task=>(!task.repeat||task.repeat==='none')&&(!task.endDate||task.date===task.endDate)).map(task=>task.id));
 for(const id of selected)if(!eligible.has(id))selected.delete(id);
 if(eligible.size){
  const bar=el(box,'div','td-overdue-controls');
  const batch=button(bar,'批量改期',()=>p.chooseTaskDate(entries.filter(({task})=>selected.has(task.id))));
  const count=el(bar,'span','td-muted td-small');
  count.setAttribute('aria-live','polite');
  const update=()=>{batch.disabled=!selected.size;count.textContent=`已选 ${selected.size} 项 · 重复及跨日任务可单独改期`;};
  update();
  for(const entry of entries)renderEntry(entry,update);
 }else for(const entry of entries)renderEntry(entry);
 function renderEntry(entry,update){
  const task=entry.task,item=el(box,'div','td-overdue-entry');
  taskRow(view,item,task);
  const actions=el(item,'div','td-overdue-controls');
  if(eligible.has(task.id)){
   const label=el(actions,'label','td-toggle'),check=el(label,'input','');
   check.type='checkbox';check.checked=selected.has(task.id);check.setAttribute('aria-label','选中 '+task.title);
   el(label,'span','','选中');check.onchange=()=>{if(check.checked)selected.add(task.id);else selected.delete(task.id);update();};
  }
  button(actions,'移到今天',()=>p.run(()=>p.rescheduleTasks([entry],C.localDate())),'td-link');
  button(actions,'移到明天',()=>p.run(()=>p.rescheduleTasks([entry],C.addDays(C.localDate(),1))),'td-link');
  button(actions,'选日期',()=>p.chooseTaskDate([entry]),'td-link');
 }
}
function focusBar(view,parent,themeHome=false){
 const p=view.plugin,box=el(parent,'section','td-focus'),left=el(box,'div','');
 if(themeHome)withIcon(el(left,'h3','td-theme-focus-heading','专注计时'),'⏱️');
 else withIcon(el(left,'div','td-eyebrow','FOCUS / 专注'),'⏱️');
 el(left,'div','td-focus-title',p.timer?.title||'留一段时间，专注当下');const time=el(box,'div','td-clock',C.duration(p.timer?C.elapsed(p.timer):0));time.dataset.timer='true';
 const actions=el(box,'div','td-focus-actions');
 if(!p.timer)button(actions,'开始计时',()=>p.run(()=>p.startTimer(null)),'mod-cta','▶️');
 else{
  button(actions,p.timer.runningSince==null?'继续':'暂停',()=>p.run(()=>p.toggleTimer())).disabled=!!p.finishing;
  button(actions,p.finishing?'保存中…':'结束并保存',()=>p.run(()=>p.finishTimer()),'mod-cta').disabled=!!p.finishing;
 }
 const totals=R.focusTotals([...p.store.sessions.values()],p.timer);const metrics=el(box,'div','td-focus-totals');for(const[key,label]of [['today','今日'],['week','本周'],['total','累计']]){const item=el(metrics,'span','');el(item,'small','td-muted',label);const value=el(item,'strong','',C.duration(totals[key]));value.dataset.focusTotal=key;}el(box,'div','td-focus-caption','正计时 · 暂停不计入 · 累计保留');
}
function themeWeek(view,target,all,today){
 const days=C.weekDates(today),date=days.includes(view.state.homeWeekDate)?view.state.homeWeekDate:today;
 const box=panel(target,'本周安排',h=>button(h,'周时间轴 ↗',()=>{
  Object.assign(view.state,{timelineMode:'week',timelineDate:date});
  view.go('timeline');
 },'td-link'),'🗓️');
 const strip=el(box,'div','td-theme-week');
 strip.setAttribute('role','group');
 strip.setAttribute('aria-label','选择本周日期');
 days.forEach((day,index)=>{
  const item=button(strip,'',()=>{view.state.homeWeekDate=day;view.render();},'td-theme-week-day');
  el(item,'small','',['周一','周二','周三','周四','周五','周六','周日'][index]);
  el(item,'strong','',String(Number(day.slice(8))));
  item.setAttribute('aria-label',day);
  item.setAttribute('aria-pressed',String(day===date));
  if(day===today)item.setAttribute('aria-current','date');
 });
 const scroll=el(box,'div','td-task-scroll');
 taskList(view,scroll,sortTasks(all.filter(t=>C.taskOnDate(t,date))),'这一天暂无安排');
}
function placeThemeHome(parent,blocks,includePlans){
 const ids=['today','week','focus','recent','inspiration','reflection'];
 const add=(target,id)=>{
  const box=el(target,'section','td-widget');
  box.dataset.widget=id;
  box.setAttribute('aria-label',D.NAMES[id]+'模块');
  blocks[id](el(box,'div','td-widget-body'));
 };
 const overview=el(parent,'div','td-theme-home-overview');
 if(includePlans)add(overview,'plans');
 const stats=el(overview,'div','td-theme-home-stats');
 add(stats,'stats');
 add(stats,'custom');
 const grid=el(parent,'div','td-theme-home-grid');
 for(const id of ids)add(grid,id);
 const trend=el(parent,'div','td-theme-home-trend');
 add(trend,'trend');
 const details=el(parent,'details','td-theme-home-more');
 el(details,'summary','','Codex 助手');
 add(el(details,'div','td-theme-home-secondary'),'assistant');
}
function renderCompletionTrend(parent,tasks,today){
 const days=D.completionTrend(tasks,today);
 const total=days.reduce((sum,day)=>sum+day.count,0);
 const peak=Math.max(1,...days.map(day=>day.count));
 const box=panel(parent,'近 14 天任务完成趋势',null,'📈');
 el(box,'p','td-trend-total',`共完成 ${total} 项 · 按实际完成日期`);
 const scroll=el(box,'div','td-trend-scroll');
 scroll.tabIndex=0;
 scroll.setAttribute('role','region');
 scroll.setAttribute('aria-label','近 14 天每日完成数');
 const chart=el(scroll,'table','td-trend-chart');
 chart.setAttribute('aria-label','任务完成趋势');
 const dates=el(el(chart,'thead'),'tr');
 const counts=el(el(chart,'tbody'),'tr');
 for(const {date,count} of days){
  const header=el(dates,'th','td-trend-date');
  header.scope='col';
  el(header,'time','',date.slice(5)).dateTime=date;
  const column=el(counts,'td','td-trend-day');
  column.title=`${date} · 完成 ${count} 项`;
  const barArea=el(column,'div','td-trend-bar-area');
  const bar=el(barArea,'span','td-trend-bar');
  bar.style.height=`${count/peak*100}%`;
  el(barArea,'strong','td-trend-count',String(count));
 }
}
function home(view,parent){
 const p=view.plugin,today=C.localDate(),all=[...p.store.tasks.values()].filter(t=>!t.deleted),tasks=sortTasks(all.filter(t=>C.taskOnDate(t,today)));
 const overdue=all.filter(t=>isOverdue(t,today));
 const themeHome=G.usesThemeHome(view.contentEl.classList.contains('td-congrong'),p.store.settings);
 const compact=themeHome||p.store.settings.compactHome?.active!==false;parent.classList.toggle('td-compact',compact);parent.classList.toggle('td-theme-home',themeHome);const gallery=p.store.settings.gallery||{};
 const includePlans=D.showPlanning(p.store.settings);
 let scenerySrc='';
 if(gallery.enabled!==false){
  const banner=el(parent,'section','td-scenery');if(!themeHome)banner.style.height=D.clamp(gallery.height,120,420,compact?120:210)+'px';
  const files=new Map(p.galleryFiles().map(f=>[f.path,f]));
  const folder=p.galleryFolder();
  const {tdMode,tdColor}=view.contentEl.dataset;
  const builtIn=new Map(scenery.filter(entry=>!entry.mode&&entry.src&&(entry.photoMode||'day')===tdMode&&(!entry.legacyFile||!files.has(folder+'/'+entry.legacyFile))).map(entry=>['builtin:'+entry.file,entry]));
  const art=!files.has(gallery.fixedFile)&&scenerySource(gallery,files.size>0)==='illustrations'&&themeArtwork(tdMode,tdColor,today);
  const chosen=art?null:D.dailyImage([...files.keys(),...builtIn.keys()],today,gallery.fixedFile);
  const file=files.get(chosen),photo=art||builtIn.get(chosen);
  if(chosen||art){
   const image=el(banner,'img','td-scenery-image');
   image.alt=photo?.label||'每日风景';scenerySrc=photo?.src||p.app.vault.getResourcePath(file);image.src=scenerySrc;
   if(art){
    banner.classList.add('td-illustrated-scenery');banner.dataset.illustration=art.file;
    image.style.objectPosition=art.position;
   }
   image.addEventListener('error',()=>{image.hidden=true;banner.classList.add('is-missing');});
  }
  const caption=el(banner,'div','td-scenery-caption');el(caption,'span','td-scenery-date',new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date()));el(caption,'strong','',themeHome?'从容 · Todo 工作台':photo?.label||(chosen?'今天，也留一点时间看风景。':'把喜欢的风景，留在这里。'));
  const credit=photo||(file?.path.startsWith(folder+'/')&&p.galleryCredits?.get(file.path.slice(folder.length+1)));
  if(credit)button(banner,art?'AI 插画':`${credit.attribution||credit.author} · ${credit.license}`,()=>photo?p.sceneryCredit(photo):p.app.workspace.openLinkText(folder+'/SOURCE_LICENSES.md','',false),'td-scenery-credit');
  button(banner,'风景设置',()=>p.dashboardPreferences(),'td-scenery-settings');
 }
 const top=el(parent,'div','td-greeting');if(!themeHome||gallery.enabled===false)heading(top,compact?null:'YOUR DAY, AT A GLANCE',themeHome?'从容 · Todo 工作台':'把今天，安排得从容一点。',compact?null:new Intl.DateTimeFormat('zh-CN',{dateStyle:'full'}).format(new Date()));
 const actions=el(top,'div','td-heading-actions');
 if(!themeHome){
  button(actions,'进入待办工作台 ↗',()=>view.go('today'),'mod-cta');
  button(actions,view.state.editLayout?'完成布局':'编辑布局',()=>{view.state.editLayout=!view.state.editLayout;view.render();});
 }
 const tools=el(actions,'details','td-layout-tools');el(tools,'summary','','布局与外观');const menu=el(tools,'div','td-layout-menu');
 if(view.contentEl.classList.contains('td-congrong'))button(menu,themeHome?'使用自定义布局':'应用从容布局',()=>p.run(()=>p.updateSettings({congrongHome:!themeHome})),'td-link');
 button(menu,includePlans?(themeHome?'隐藏计划模块':'隐藏计划与本周模块'):(themeHome?'显示计划模块':'显示计划与本周模块'),()=>p.run(()=>p.updateSettings({planningWidgets:!includePlans})),'td-link');
 if(!themeHome){
  button(menu,'应用紧凑推荐布局',()=>p.run(()=>p.applyCompactLayout()),'td-link');
  if(p.store.settings.compactHome?.previous)button(menu,'恢复之前布局',()=>p.run(()=>p.restoreHomeLayout()),'td-link');
 }
 button(menu,'风景与布局设置',()=>p.dashboardPreferences(),'td-link');
 const notes=p.notes();
 const metrics=[['今日任务',tasks.length,`${tasks.filter(t=>t.status==='done').length} 项已完成`],['逾期待处理',overdue.length,'查看逾期清单',()=>view.showOverdue()],['笔记库',notes.length,'近 7 天：新增 '+notes.filter(f=>f.stat.ctime>=Date.now()-7*86400000).length+' / 修改 '+notes.filter(f=>f.stat.mtime>=Date.now()-7*86400000).length]];
 if(!themeHome&&view.state.editLayout)el(parent,'p','td-layout-hint','拖动卡片标题换位，拖右下角调整大小；靠近边缘自动滚动，Esc 取消。');
 const blocks={
  stats:target=>{const stats=el(target,'div','td-stats');for(const [label,value,detail,action]of metrics){const card=el(stats,'div','td-stat');el(card,'div','td-muted',label);el(card,'strong','',value);if(action)button(card,detail,action,'td-link');else el(card,'small','td-muted',detail);}},
  plans:target=>P.summary(view,target,{el,button,select,heading,panel},scenerySrc),
  trend:target=>renderCompletionTrend(target,all,today),
  week:target=>{if(themeHome)return themeWeek(view,target,all,today);const box=panel(target,'本周任务',h=>button(h,'周时间轴 ↗',()=>{view.state.timelineMode='week';view.go('timeline');},'td-link'),'🗓️'),scroll=el(box,'div','td-task-scroll'),days=C.weekDates(today);taskList(view,scroll,sortTasks(all.filter(t=>days.some(d=>C.taskOnDate(t,d)))),'本周还没有任务');},
  focus:target=>focusBar(view,target,themeHome),
  inspiration:target=>J.renderInspiration(view,target,{el,button,select,panel}),
  reflection:target=>compact?H.renderReflectionSummary(view,target,{el,button,panel}):J.renderReflection(view,target,{el,button,select,panel}),
  today:target=>{
   const todo=panel(target,'今日待办',h=>{
    const actions=el(h,'div','td-heading-actions');
    if(themeHome&&overdue.length)button(actions,`逾期 ${overdue.length} 项`,()=>view.showOverdue(),'td-theme-overdue');
    button(actions,'快速记任务',()=>p.quickTask(),themeHome?'mod-cta':'td-link','✏️');
    if(!themeHome)button(actions,'＋ 新建',()=>p.editTask(null,{date:today}),'td-link');
   },pageIcons.today);
   const scroll=el(todo,'div','td-task-scroll');
   const tabletPreview=themeHome&&p.layoutDevice==='tablet';
   taskList(view,scroll,tabletPreview?tasks.slice(0,3):tasks,'今天还没有安排，写下第一件想做的事。');
   if(tabletPreview&&tasks.length>3)button(todo,'查看全部',()=>{
    Object.assign(view.state,{taskRange:'today',list:'',query:'',showDone:true});
    view.go('today');
   },'td-link');
   if(!themeHome&&overdue.length)button(todo,`${overdue.length} 项逾期，点击处理 →`,()=>view.showOverdue(),'td-overdue td-link');
  },
  recent:target=>{const recent=panel(target,'最近笔记',h=>select(h,[['modified','最近修改'],['created','最近创建']],p.store.settings.recentSort||'modified',v=>p.run(()=>p.updateSettings({recentSort:v}))),'📓');const scroll=el(recent,'div','td-note-scroll');scroll.setAttribute('aria-label','最近笔记列表');const exclude=p.store.settings.excludedFolders||[];const recentNotes=notes.filter(f=>!exclude.some(x=>f.path.startsWith(x+'/'))).sort((a,b)=>(p.store.settings.recentSort==='created'?b.stat.ctime-a.stat.ctime:b.stat.mtime-a.stat.mtime)).slice(0,50);if(!recentNotes.length)empty(scroll,'笔记会显示在这里');for(const f of recentNotes){const b=button(scroll,'',()=>p.app.workspace.openLinkText(f.path,'',false),'td-note');el(b,'span','',f.basename||f.path.split('/').pop().replace(/\.md$/,''));el(b,'small','td-muted',f.path);}},
  custom:target=>{const custom=panel(target,'我的笔记统计',h=>button(h,'＋ 添加统计',()=>p.editStat(),'td-link'),'📊');const cards=el(custom,'div','td-custom-stats');if(!(p.store.settings.stats||[]).length)empty(cards,'添加文件夹或标签，观察知识积累。');for(const stat of p.store.settings.stats||[]){const matches=notes.filter(f=>C.matchesNote(f.path,p.noteTags(f),stat));const card=el(cards,'div','td-custom-stat');button(card,`${stat.kind==='tag'?'#':'▱'} ${stat.value}`,()=>p.showNotes(stat.value,matches),'td-link');el(card,'strong','',matches.length);button(card,'移除',()=>p.run(()=>p.updateSettings({stats:p.store.settings.stats.filter(x=>x.id!==stat.id)})),'td-small td-muted');}},
  assistant:target=>compact?H.renderAssistantSummary(view,target,{el,button,panel}):A.renderAssistant(view,target,{el,button,select,heading,panel,empty})
 };
 if(themeHome)placeThemeHome(parent,blocks,includePlans);
 else D.placeWidgets(view,parent,blocks,{el,button,select});
}
function calendar(view,parent){
 const p=view.plugin,s=view.state,month=C.parseDate(s.month+'-01');const nav=el(parent,'div','td-calendar-nav');button(nav,'‹ 上月',()=>{view.state.month=C.localDate(new Date(month.getFullYear(),month.getMonth()-1,1)).slice(0,7);view.render();});
 el(nav,'h3','',`${month.getFullYear()} 年 ${month.getMonth()+1} 月`);button(nav,'下月 ›',()=>{s.month=C.localDate(new Date(month.getFullYear(),month.getMonth()+1,1)).slice(0,7);view.render();});button(nav,'今天',()=>{s.month=C.localDate().slice(0,7);s.selectedDate=C.localDate();view.render();},'td-link');
 S.legend(parent,{el});const grid=el(parent,'div','td-calendar');for(const d of ['周一','周二','周三','周四','周五','周六','周日'])el(grid,'div','td-weekday',d);
 const start=C.addDays(s.month+'-01',-((month.getDay()+6)%7));const tasks=filtered(view,[...p.store.tasks.values()]);
 for(let i=0;i<42;i++){
  const date=C.addDays(start,i),cell=el(grid,'div','td-day'+(date.slice(0,7)!==s.month?' is-outside':'')+(date===C.localDate()?' is-today':'')+(date===s.selectedDate?' is-selected':''));
  const head=el(cell,'div','td-day-header');
  const b=button(head,String(Number(date.slice(8))),()=>{s.selectedDate=date;view.render();},'td-day-number');b.setAttribute('aria-label',date+' 查看日程');b.setAttribute('aria-pressed',String(date===s.selectedDate));
  const entries=tasks.filter(t=>C.taskOnDate(t,date));
  if(entries.length)el(head,'small','td-day-count',String(entries.length)).setAttribute('aria-label',entries.length+' 项任务');
  const list=el(cell,'div','td-day-tasks');list.setAttribute('role','group');list.setAttribute('aria-label',date+' 的任务，可滚动查看');if(entries.length)list.tabIndex=0;
  for(const t of entries){const tb=button(list,t.title,()=>p.editTask(t),'td-calendar-task'+(t.status==='done'?' is-done':''));tb.style.setProperty('--task-color',C.DIFFICULTIES[t.difficulty||'normal'].color);tb.title=t.title;tb.setAttribute('aria-label',t.title+(t.status==='done'?'，已完成':''));}
 }
 const detail=panel(parent,`${s.selectedDate} 的安排`,h=>button(h,'＋ 添加任务',()=>p.editTask(null,{date:s.selectedDate}),'td-link'));
 taskList(view,detail,tasks.filter(t=>C.taskOnDate(t,s.selectedDate)),'当天没有安排');
}
function timeline(view,parent){S.renderTimeline(view,parent,{el,button,select},filtered(view,[...view.plugin.store.tasks.values()]));}
function workspace(view,parent){
 const p=view.plugin,s=view.state;
 const switcher=el(parent,'div','td-work-switcher');for(const[key,name]of [['today','列表'],['calendar','月历'],['quadrants','四象限'],['timeline','时间轴'],['plans','计划']])button(switcher,name,()=>view.go(key),'td-button'+(s.page===key?' is-active':''),pageIcons[key]);
 if(s.page==='plans')return P.renderPlans(view,parent,{el,button,select,heading,panel});
 const h=el(parent,'div','td-work-heading');heading(h,'PLAN / DO / REFLECT',pageNames[s.page],s.page==='quadrants'?'今日处理仅显示安排在今天的任务。':'让安排与实际投入，清晰可见。',pageIcons[s.page]);button(h,'＋ 新建任务',()=>p.editTask(null,{date:['today','quadrants'].includes(s.page)?C.localDate():''}),'mod-cta');
 const toolbar=el(parent,'div','td-toolbar');
 select(toolbar,[['','全部清单'],...(p.store.settings.lists||[]).map(l=>[l.id,l.name])],s.list,v=>{s.list=v;view.render();});
 const search=el(toolbar,'input','td-input');search.placeholder='搜索任务…';search.value=s.query;search.setAttribute('aria-label','搜索任务');search.addEventListener('change',()=>{s.query=search.value;view.render();});
 const label=el(toolbar,'label','td-toggle'),check=el(label,'input','');check.type='checkbox';check.checked=s.showDone;el(label,'span','','显示已完成');check.addEventListener('change',()=>{s.showDone=check.checked;view.render();});
 if(s.page==='calendar')return calendar(view,parent);
 if(s.page==='timeline')return timeline(view,parent);
 const all=[...p.store.tasks.values()],tasks=filtered(view,all);
 if(s.page==='today'){
  const ranges=el(parent,'div','td-list-ranges'),active=s.taskRange||'today';
  for(const[key,name]of [['today','今日与逾期'],['overdue','逾期待处理'],['all','全部待办'],['inbox','未安排'],['lists','分类管理'],['trash','回收站']]){
   button(ranges,name,()=>{if(['lists','trash'].includes(key))view.go(key);else{s.taskRange=key;s.overdueSelection?.clear();view.render();}},'td-link'+(active===key?' is-active':''));
  }
  const today=C.localDate(),late=tasks.filter(t=>isOverdue(t,today));
  if(active==='overdue')return overdueList(view,parent,late);
  if(active==='all')return taskList(view,panel(parent,'全部待办'),tasks);
  if(active==='inbox')return taskList(view,panel(parent,'未安排'),tasks.filter(t=>!t.date));
  taskList(view,panel(parent,'今天'),tasks.filter(t=>C.taskOnDate(t,today)));
  if(late.length)taskList(view,panel(parent,`逾期 · ${late.length}`,h=>button(h,'处理逾期 →',()=>view.showOverdue(),'td-link')),late);
 }else if(s.page==='inbox')taskList(view,panel(parent,'未安排日期'),tasks.filter(t=>!t.date));
 else if(s.page==='quadrants'){
  const today=C.localDate(),grid=el(parent,'div','td-quadrants');
  for(const [key,name]of Object.entries(C.QUADRANTS)){
   const box=panel(grid,name,h=>button(h,'＋',()=>p.editTask(null,{quadrant:key,date:key==='today'?C.localDate():''}),'td-link').setAttribute('aria-label','新建'+name+'任务'));
   box.classList.add('td-q-'+key);
   taskList(view,box,tasks.filter(t=>t.quadrant===key&&(key!=='today'||C.taskOnDate(t,today))));
  }
 }else if(s.page==='lists'){
  button(parent,'＋ 创建清单',()=>p.editList(),'td-link');
  for(const list of [{id:'',name:'未分类',color:'#149e9a'},...(p.store.settings.lists||[])]){const box=panel(parent,list.name,h=>{if(list.id)button(h,'编辑颜色 / 名称',()=>p.editList(list),'td-link');button(h,'＋ 任务',()=>p.editTask(null,{listId:list.id}),'td-link');});box.style.setProperty('--task-color',list.color);taskList(view,box,tasks.filter(t=>(t.listId||'')===list.id));}
 }else if(s.page==='trash'){
  const deleted=all.filter(t=>t.deleted);if(!deleted.length)empty(parent,'回收站是空的');for(const t of deleted){const row=el(parent,'div','td-task');el(row,'span','td-grow',t.title);button(row,'恢复',()=>p.run(()=>p.saveTask({...t,deleted:false})),'td-link');}
 }
}
function render(view){
 const p=view.plugin,host=view.contentEl;host.replaceChildren();host.classList.add('td-host');D.applyTheme(host,p.store.settings.theme);const root=el(host,'div','td-shell');
 const themeActive=G.themeIsActive(host.ownerDocument);
 host.classList.toggle('td-congrong',themeActive);
 const aside=el(root,'header','td-sidebar td-topbar');el(aside,'div','td-brand','○  从容');el(aside,'div','td-brand-sub','TODO WORKSPACE');
 const nav=el(aside,'nav','td-navigation');for(const [key,name]of [['home','首页'],['today','待办与日程'],['journal','灵感与复盘'],['courses','课程整理'],['assistant','Codex 助手']])button(nav,name,()=>view.go(key),'td-nav'+((key===view.state.page||key==='today'&&['calendar','timeline','quadrants','plans','inbox','lists','trash'].includes(view.state.page))?' is-active':''),pageIcons[key]);
 const switcher=el(aside,'div','td-scheme-switch');
 switcher.setAttribute('role','group');switcher.setAttribute('aria-label','白天与夜晚模式');
 for(const [scheme,label] of [['warm','白天'],['night','夜晚']]){
  const option=button(switcher,label,()=>p.changeScheme(scheme));
  option.setAttribute('aria-pressed',String((host.dataset.tdMode==='night')===(scheme==='night')));
 }
 button(aside,'主题',()=>p.themePreferences(),'td-theme-button','🎨').setAttribute('aria-label','工作台主题');
 const footer=el(aside,'div','td-sidebar-footer');el(footer,'span','td-muted','数据保存在笔记库');button(footer,'刷新数据',()=>p.run(()=>p.reload()),'td-link');button(footer,'偏好设置',()=>p.preferences(),'td-link');
 const main=el(root,'main','td-main');const errors=[...p.store.errors,...(p.journal?.errors||[]),...(p.courses?.errors||[])];if(errors.length){const banner=el(main,'div','td-warning');el(banner,'span','',`${errors.length} 个数据文件需要检查，原文件已保留。`);button(banner,'查看详情',()=>p.showErrors(),'td-link');}
 if(view.state.page==='home')home(view,main);else if(view.state.page==='journal')J.renderJournal(view,main,{el,button,select,panel,heading,empty});else if(view.state.page==='courses')require('./course-view.cjs').renderCourses(view,main,{el,button,select,panel,heading,empty});else if(view.state.page==='assistant')A.renderAssistant(view,main,{el,button,select,heading,panel,empty});else{workspace(view,main);focusBar(view,main);}
}
module.exports={el,button,select,empty,heading,panel,render,pageNames,themeArtwork,scenerySource};
