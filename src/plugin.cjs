'use strict';
const {Plugin,ItemView,Modal,Notice,PluginSettingTab,getAllTags,Platform,requestUrl}=require('obsidian');
const C=require('./core.cjs');const {Store}=require('./store.cjs');const V=require('./views.cjs');
const D=require('./dashboard.cjs');const A=require('./assistant.cjs');const R=require('./reflection.cjs');const {JournalStore}=require('./journal.cjs');const {CourseService}=require('./course.cjs');const {XftjBridge}=require('./xftj-bridge.cjs');const {ShareReader}=require('./share-reader.cjs');const {GenerationRunner}=require('./generation.cjs');const {DocumentReader}=require('./documents.cjs');
const VIEW='todo-dashboard-view';
const DEFAULTS={lists:[{id:'study',name:'学习',color:'#149e9a'},{id:'work',name:'工作',color:'#6488d8'},{id:'life',name:'生活',color:'#d58c48'}],stats:[],recentSort:'modified',excludedFolders:[]};
function clone(o){return JSON.parse(JSON.stringify(o));}
function formField(parent,label,type,value){const wrap=V.el(parent,'label','td-field');V.el(wrap,'span','',label);const input=V.el(wrap,type==='textarea'?'textarea':'input','td-input');if(type!=='textarea')input.type=type;input.value=value??'';return input;}
function formSelect(parent,label,options,value){const wrap=V.el(parent,'label','td-field');V.el(wrap,'span','',label);const input=V.select(wrap,options,value,()=>{});input.setAttribute('aria-label',label);return input;}
function validRoot(root){return !!root&&root===root.trim()&&!root.startsWith('.')&&!root.startsWith('/')&&!root.includes('\\')&&!root.split('/').some(s=>!s||s==='.'||s==='..'||/[<>:"|?*]/.test(s));}
class TaskModal extends Modal{
 constructor(p,task,seed={}){super(p.app);this.p=p;this.original=task;this.token=task?p.store.token('task',task.id):undefined;this.task=clone(task||{id:C.uid(),title:'',description:'',status:'open',date:'',startTime:'',endTime:'',quadrant:'today',listId:'',repeat:'none',subtasks:[],createdAt:new Date().toISOString(),...seed});}
 onOpen(){
  const t=this.task,root=this.contentEl;root.classList.add('td-modal');V.heading(root,'TASK / 任务',this.original?'编辑任务':'写下一个安排');
  const form=V.el(root,'form','td-form');this.form=form;const title=formField(form,'任务名称','text',t.title);title.required=true;title.placeholder='下一件想做的事…';
  const grid=V.el(form,'div','td-form-grid');const date=formField(grid,'计划日期（可留空）','date',t.date),start=formField(grid,'开始时间（可选）','time',t.startTime),end=formField(grid,'结束时间（可选）','time',t.endTime);
  const list=formSelect(grid,'分类清单',[['','未分类'],...(this.p.store.settings.lists||[]).map(l=>[l.id,l.name])],t.listId||'');
  const q=formSelect(grid,'所属象限',Object.entries(C.QUADRANTS),t.quadrant||'today');
  const repeat=formSelect(grid,'重复规则',[['none','不重复'],['daily','每天'],['weekly','每周'],['monthly','每月']],t.repeat||'none');
  V.el(form,'p','td-muted td-small','重复任务未完成时不生成下一次；完成后安排下一个周期。');
  const desc=formField(form,'备注','textarea',t.description),note=formField(form,'关联笔记路径（可选）','text',t.note||'');note.placeholder='例如：科研/综述.md';
  if(t.note)V.button(form,'打开关联笔记 ↗',()=>this.p.app.workspace.openLinkText(t.note,'',false),'td-link');
  const subSection=V.el(form,'div','td-subtasks');V.el(subSection,'h3','','步骤 / 子任务');const rows=V.el(subSection,'div','');
  const renderSubs=()=>{rows.replaceChildren();t.subtasks.forEach((s,i)=>{const row=V.el(rows,'div','td-subtask-edit');const check=V.el(row,'input','td-check');check.type='checkbox';check.checked=s.done;check.setAttribute('aria-label','完成子任务');check.onchange=()=>{s.done=check.checked;};const text=V.el(row,'input','td-input');text.value=s.title;text.setAttribute('aria-label','子任务名称');text.oninput=()=>{s.title=text.value;};V.button(row,'移除',()=>{t.subtasks.splice(i,1);renderSubs();},'td-small');});};renderSubs();V.button(subSection,'＋ 添加步骤',()=>{t.subtasks.push({id:C.uid(),title:'',done:false});renderSubs();},'td-link');
  const error=V.el(form,'p','td-error');error.setAttribute('role','alert');const actions=V.el(form,'div','td-modal-actions');
  if(this.original){V.button(actions,'删除任务',()=>this.commit(async()=>{await this.p.saveTask({...this.original,deleted:true},this.token);this.close();},error),'td-danger');V.button(actions,t.status==='done'?'取消完成':'标记完成',()=>this.commit(async()=>{const edited=this.read();await this.p.saveTask(edited,this.token);await this.p.toggleTask(edited);this.close();},error));}
  V.button(actions,'取消',()=>this.close());const save=V.button(actions,'保存任务',()=>{} ,'mod-cta');save.type='submit';
  this.read=()=>{
   if(!title.value.trim())throw Error('请输入任务名称');if(repeat.value!=='none'&&!date.value)throw Error('重复任务需要计划日期');
   if(start.value&&end.value&&end.value<=start.value)throw Error('结束时间需晚于开始时间；跨日安排请拆为两天');
   const dateChanged=date.value!==t.date;
   return {...t,title:title.value.trim(),date:date.value,startTime:start.value,endTime:end.value,listId:list.value,quadrant:q.value,repeat:repeat.value,repeatAnchor:date.value?(dateChanged?Number(date.value.slice(8)):t.repeatAnchor||Number(date.value.slice(8))):null,description:desc.value,note:note.value.trim(),subtasks:t.subtasks.filter(s=>s.title.trim()).map(s=>({...s,title:s.title.trim()})),updatedAt:new Date().toISOString()};
  };
  form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())this.commit(async()=>{await this.p.saveTask(this.read(),this.token);this.close();},error);};
  setTimeout(()=>title.focus(),50);
 }
 async commit(action,error){if(this.busy)return;this.busy=true;try{await action();}catch(e){error.textContent=e.message;}finally{this.busy=false;}}
 onClose(){this.contentEl.replaceChildren();}
}
class SimpleModal extends Modal{
 constructor(p,title,build){super(p.app);this.titleText=title;this.build=build;}
 onOpen(){this.contentEl.classList.add('td-modal');V.heading(this.contentEl,'TODO WORKSPACE',this.titleText);this.build(this.contentEl,this);}
 onClose(){this.contentEl.replaceChildren();}
}
class DashboardView extends ItemView{
 constructor(leaf,p){super(leaf);this.plugin=p;this.state={page:'home',month:C.localDate().slice(0,7),selectedDate:C.localDate(),timelineDate:C.localDate(),list:'',showDone:false,query:''};}
 getViewType(){return VIEW;}getDisplayText(){return '从容 · Todo 工作台';}getIcon(){return 'layout-dashboard';}
 getLayoutTier(){const width=this.contentEl.clientWidth;return width<=650?'narrow':width<1100?'middle':'wide';}
 async onOpen(){this.plugin.views.add(this);this.layoutTier=this.getLayoutTier();const Observer=this.contentEl.ownerDocument?.defaultView?.ResizeObserver;if(Observer){this.resizeObserver=new Observer(()=>{const tier=this.getLayoutTier();if(tier!==this.layoutTier){this.layoutTier=tier;if(this.plugin.interacting)this.plugin.pendingRefresh=true;else this.render();}});this.resizeObserver.observe(this.contentEl);}this.render();}
 async onClose(){this.resizeObserver?.disconnect();this.layoutCleanup?.();this.plugin.interacting=false;this.plugin.assistant?.unsubscribe(this);this.plugin.views.delete(this);if(this.plugin.pendingRefresh)this.plugin.refresh();}
 go(page){if(page==='courses'&&!this.state.course?.busy&&this.state.course)this.state.course.courses=null;this.state.page=page;this.render();}
 render(){
  this.layoutCleanup?.();this.plugin.interacting=false;
  this.plugin.assistant?.unsubscribe(this);
  if(this.plugin.ready===false){const host=this.contentEl;host.replaceChildren();host.classList.add('td-host');const box=V.el(host,'div','td-main');V.heading(box,'TODO WORKSPACE',this.plugin.initError?'工作台暂未加载完成':'正在加载工作台…',this.plugin.initError||'等待笔记库就绪');if(this.plugin.initError)V.button(box,'重试加载',()=>this.plugin.run(()=>this.plugin.initializeData()),'mod-cta');return;}
  V.render(this);
 }
}
class SettingsTab extends PluginSettingTab{
 constructor(app,p){super(app,p);this.p=p;}
 display(){this.containerEl.replaceChildren();V.heading(this.containerEl,'TODO WORKSPACE','Todo 工作台');V.el(this.containerEl,'p','','任务和专注记录保存在普通笔记库文件中。请将 Todo工作台 与 课程笔记 两个目录纳入 EasySync，两端均需安装插件。');V.button(this.containerEl,'打开偏好设置',()=>this.p.preferences(),'mod-cta');V.el(this.containerEl,'p','td-muted','当前数据目录：'+this.p.store.root);}
}
class TodoPlugin extends Plugin{
 async onload(){
  this.views=new Set();this.lastDay=C.localDate();this.ready=false;this.local=(await this.loadData())||{};
  this.local.root=validRoot(this.local.root)?this.local.root:'Todo工作台';
  this.store=new Store(this.app.vault,this.local.root);this.registerView(VIEW,leaf=>new DashboardView(leaf,this));
  this.timer=null;this.localKey=`todo-dashboard:timer:${this.app.vault.getName()}:${this.local.root}`;
  this.assistant=new A.AssistantController(this,{desktop:!!Platform?.isDesktopApp});this.layoutDevice=Platform?.isDesktopApp?'desktop':'tablet';this.galleryCredits=new Map();
  this.journal=new JournalStore(this.app.vault,this.store.root,path=>this.store.ensureFolder(path));
  let xftj={};try{xftj=JSON.parse(localStorage.getItem(this.localKey+':xftj')||'{}');}catch{}this.xftjSettings=xftj;
  this.courseBridge=Platform?.isDesktopApp?new XftjBridge({script:xftj.script,python:xftj.python||'python'}):null;
  this.shareReader=new ShareReader({request:options=>requestUrl(options)});
  this.courses=new CourseService({vault:this.app.vault,ensureFolder:path=>this.store.ensureFolder(path),generate:(prompt,options)=>this.generateJob(prompt,options),bridge:this.courseBridge,shareReader:this.shareReader,reader:Platform?.isDesktopApp?new DocumentReader():null});
  try{this.timer=JSON.parse(localStorage.getItem(this.localKey)||'null');}catch{new Notice('计时恢复数据损坏，请检查本机存储');}
  if(this.timer&&(!Array.isArray(this.timer.segments)||typeof this.timer.accumulated!=='number'))this.timer=null;
  this.addRibbonIcon('layout-dashboard','打开 Todo 首页',()=>this.open());
  this.addCommand({id:'open-dashboard',name:'打开首页仪表盘',callback:()=>this.open()});
  this.addCommand({id:'open-calendar',name:'打开日程概览',callback:()=>this.open('calendar')});
  this.addCommand({id:'open-courses',name:'打开课程录音与习题整理',callback:()=>this.open('courses')});
  this.addCommand({id:'open-journal',name:'打开灵感与复盘',callback:()=>this.open('journal')});
  this.addCommand({id:'open-codex',name:'打开 Codex 笔记助手',callback:()=>this.open('assistant')});
  this.addCommand({id:'new-task',name:'新建任务',callback:()=>this.editTask(null,{date:C.localDate()})});
  this.addCommand({id:'toggle-focus',name:'开始 / 暂停 / 继续专注',callback:()=>this.run(()=>this.timer?this.toggleTimer():this.startTimer(null))});
  this.addSettingTab(new SettingsTab(this.app,this));
  for(const event of ['create','modify','delete','rename'])this.registerEvent(this.app.vault.on(event,(file,oldPath)=>{if(file.path.startsWith(this.store.root+'/')||oldPath?.startsWith(this.store.root+'/')||file.path.startsWith(this.courses.root+'/')||oldPath?.startsWith(this.courses.root+'/'))this.scheduleReload(file);else if(file.extension==='md')this.scheduleRender();}));
  this.registerEvent(this.app.metadataCache.on('changed',file=>{if(!file?.path?.startsWith(this.store.root+'/'))this.scheduleRender();}));
  this.registerInterval(globalThis.setInterval(()=>this.tick(),1000));
  this.registerDomEvent(document,'visibilitychange',()=>{if(document.hidden){this.hiddenAt=Date.now();this.persistTimer();}else{const gap=this.hiddenAt?Date.now()-this.hiddenAt:0;if(gap>60000&&this.timer?.runningSince!=null)this.reviewTimer(this.hiddenAt);else this.refresh();this.hiddenAt=null;}});
  this.app.workspace.onLayoutReady(()=>this.run(async()=>{await this.initializeData();if(this.local.autoOpen!==false)await this.open();if(this.timer)this.reviewTimer(this.timer.savedAt||Date.now());}));
 }
 async initializeData(){
  if(this.initializing)return this.initializing;
  this.initError=null;
  this.initializing=(async()=>{
   await this.store.load();await this.journal.load();
   const settingsPath=this.store.root+'/设置.md';
   if(!this.store.paths.has('settings:settings')&&!this.app.vault.getAbstractFileByPath(settingsPath)&&!await this.app.vault.adapter?.exists?.(settingsPath))await this.store.saveSettings(clone(DEFAULTS));
   if(!this.store.errors.some(e=>e.path===settingsPath)){const compact=D.migrateCompactSettings(this.store.settings);if(compact!==this.store.settings)await this.store.saveSettings(compact,this.store.token('settings','settings'));}
   await this.repairRepeats();await this.loadGalleryCredits();this.ready=true;this.refresh();
  })().catch(error=>{this.initError=error.message;this.refresh();throw error;}).finally(()=>{this.initializing=null;});
  return this.initializing;
 }
 onunload(){this.jobAbort?.abort();for(const view of this.views)view.layoutCleanup?.();clearTimeout(this.reloadHandle);clearTimeout(this.renderHandle);this.assistant?.close();this.persistTimer();}
 async run(fn){try{return await fn();}catch(e){console.error('[Todo 工作台]',e);new Notice('操作未完成：'+e.message,8000);}}
 refresh(){if(this.interacting){this.pendingRefresh=true;return;}this.pendingRefresh=false;for(const v of this.views)v.render();}
 tick(today=C.localDate()){if(this.lastDay!==today){this.lastDay=today;this.refresh();}for(const view of this.views){for(const e of view.contentEl.querySelectorAll('[data-timer]'))e.textContent=C.duration(this.timer?C.elapsed(this.timer):0);const totals=R.focusTotals([...(this.store.sessions?.values()||[])],this.timer);for(const e of view.contentEl.querySelectorAll('[data-focus-total]'))e.textContent=C.duration(totals[e.dataset.focusTotal]||0);}}
 scheduleRender(){clearTimeout(this.renderHandle);this.renderHandle=setTimeout(()=>this.refresh(),400);}
 scheduleReload(file){if(this.ready===false)return;if(file&&file.extension!=='md')this.assetDirty=true;clearTimeout(this.reloadHandle);this.reloadHandle=setTimeout(()=>this.run(()=>this.reload()),350);}
 async reload(){const fingerprint=()=>JSON.stringify([...(this.store.snapshots||[])].sort((a,b)=>a[0].localeCompare(b[0])))+JSON.stringify(this.store.errors)+JSON.stringify([...(this.journal?.snapshots||[])])+JSON.stringify(this.journal?.errors);const before=fingerprint();await this.store.load();await this.journal?.load();await this.repairRepeats();await this.loadGalleryCredits();if(before!==fingerprint()||this.assetDirty){this.assetDirty=false;this.refresh();}}
 async repairRepeats(){
  for(const task of [...this.store.tasks.values()]){
   if(task.deleted||task.status!=='done'||!task.completedAt||task.repeatIssued)continue;
   try{
    const revision=this.store.token?.('task',task.id);
    const next=C.nextOccurrence(task,task.completedAt);if(!next)continue;
    const series=task.seriesId||task.id;
    const successorExists=[...this.store.tasks.values()].some(t=>t.id!==task.id&&(t.seriesId||t.id)===series&&(t.status==='open'||t.date>task.date));
    if(!successorExists&&!this.store.tasks.has(next.id))await this.store.ensureTask(next);
    await this.store.saveTask({...task,repeatIssued:true},revision);
   }catch(e){this.store.errors.push({path:this.store.paths?.get('task:'+task.id)||`任务 ${task.id}`,message:'重复任务修复失败：'+e.message});}
  }
 }
 async open(page='home'){
  let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}await this.app.workspace.revealLeaf(leaf);leaf.view.go(page);
 }
 list(id){return (this.store.settings.lists||[]).find(l=>l.id===id);}
 notes(){return this.app.vault.getMarkdownFiles().filter(f=>!f.path.startsWith(this.store.root+'/'));}
 noteTags(file){const cache=this.app.metadataCache.getFileCache(file);return cache?(getAllTags(cache)||[]):[];}
 editTask(task,seed={}){if(this.ready===false){new Notice('工作台正在等待笔记库加载，请稍后重试');return;}new TaskModal(this,task,seed).open();}
 async saveTask(task,token){if(this.ready===false)throw Error('笔记库尚未加载完成');await this.store.saveTask({...task,updatedAt:new Date().toISOString()},token);this.refresh();}
 async toggleTask(task){
  const current=this.store.tasks.get(task.id);if(!current)return;
  if(current.status==='done'){
   if([...this.store.tasks.values()].some(t=>!t.deleted&&t.id!==current.id&&t.status==='open'&&(t.seriesId||t.id)===(current.seriesId||current.id))){new Notice('该系列已有下一次任务，请先处理下一次，再取消本次完成。',7000);return;}
   await this.saveTask({...current,status:'open',completedAt:null,repeatIssued:false});
  }else{const result=C.completeTask(current);await this.saveTask(result.task);const revision=this.store.token?.('task',current.id);if(result.next){await this.store.ensureTask(result.next);await this.saveTask({...result.task,repeatIssued:true},revision);}}
  this.refresh();
 }
 async generateJob(prompt,{images=[],signal}={}){if(!this.assistant?.desktop)throw Error('Codex 自动整理请在 Windows 电脑使用');if(this.jobBusy||this.assistant.state.busy)throw Error('Codex 正在处理其他请求，请先等待或停止');this.jobBusy=true;const controller=new AbortController(),abort=()=>controller.abort();this.jobAbort=controller;signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();try{const executable=this.assistant.state.executable||A.findExecutable(),cwd=this.app.vault.adapter.getBasePath?.();if(!executable||!cwd)throw Error('请先在 Codex 连接设置检查本机 CLI 和笔记库目录');return await new GenerationRunner({executable,cwd,model:this.assistant.state.model}).run(prompt,{images,signal:controller.signal});}finally{signal?.removeEventListener('abort',abort);this.jobBusy=false;this.jobAbort=null;}}
 coursePreferences(){new SimpleModal(this,'讯飞听见本机连接',(root,m)=>{V.el(root,'p','td-muted','使用本机 xftj-transcribe 工具和官方授权。凭据不写入笔记库；仅列出录音并读取已有稿，不发起付费转写。');const script=formField(root,'xftj.py 完整路径（留空自动查找）','text',this.xftjSettings.script||'');const python=formField(root,'Python 可执行文件或完整路径','text',this.xftjSettings.python||'python');V.button(root,'保存讯飞连接设置',()=>{if(this.views.size&&[...this.views].some(v=>v.state.course?.busy)){new Notice('请先停止课程操作');return;}this.xftjSettings={script:script.value.trim(),python:python.value.trim()||'python'};localStorage.setItem(this.localKey+':xftj',JSON.stringify(this.xftjSettings));this.courseBridge=new XftjBridge(this.xftjSettings);this.courses.bridge=this.courseBridge;m.close();this.refresh();},'mod-cta');}).open();}
 async applyCompactLayout(){const token=this.store.token('settings','settings');await this.updateSettings(D.applyCompactSettings(this.store.settings),token);}
 async restoreHomeLayout(){const token=this.store.token('settings','settings');await this.updateSettings(D.restoreCompactSettings(this.store.settings),token);}
 async updateSettings(patch,token){await this.store.saveSettings({...this.store.settings,...patch},token);if(patch.gallery)await this.loadGalleryCredits();this.refresh();}
 galleryFolder(){return this.store.settings.gallery?.folder||this.store.root+'/风景图库';}
 galleryFiles(){const folder=this.galleryFolder();const fixed=this.store.settings.gallery?.fixedFile;return this.app.vault.getFiles().filter(f=>(f.path.startsWith(folder+'/')||f.path===fixed)&&/\.(jpe?g|png|webp)$/i.test(f.path));}
 async loadGalleryCredits(){this.galleryCredits=new Map();const f=this.app.vault.getAbstractFileByPath(this.galleryFolder()+'/SOURCE_LICENSES.json');if(!f)return;try{const list=JSON.parse(await this.app.vault.read(f));if(Array.isArray(list))for(const entry of list)if(entry&&typeof entry.file==='string')this.galleryCredits.set(entry.file,entry);}catch{}}
 dashboardPreferences(){const token=this.store.token('settings','settings'),g=this.store.settings.gallery||{};new SimpleModal(this,'风景与布局设置',(root,m)=>{
  const enabled=formSelect(root,'首页风景栏',[['yes','显示'],['no','隐藏']],g.enabled===false?'no':'yes');
  const folder=formField(root,'图库文件夹（库内路径）','text',this.galleryFolder());const fixed=formField(root,'固定图片（可选，留空每日轮换）','text',g.fixedFile||'');
  const height=formField(root,'风景栏高度（120–420）','number',g.height||120);height.min='120';height.max='420';
  V.el(root,'p','td-muted','照片和署名清单保存在库内，通过 EasySync 同步；没有网络时继续使用本地照片。');
  const error=V.el(root,'p','td-error');const download=V.button(root,'下载精选风景图库（约 4.4 MB）',async()=>{download.disabled=true;try{await this.downloadScenery();new Notice('图库下载完成');}catch(e){error.textContent=e.message;}finally{download.disabled=false;}},'td-link');
  const pick=V.el(root,'input','td-input');pick.type='file';pick.accept='image/jpeg,image/png,image/webp';pick.multiple=true;pick.setAttribute('aria-label','导入自己的风景照片');pick.addEventListener('change',()=>this.run(()=>this.importScenery([...pick.files])));
  V.button(root,'恢复默认模块布局',()=>this.run(async()=>{await this.applyCompactLayout();m.close();}),'td-link');
  V.button(root,'保存',async()=>{try{const value=folder.value.trim();if(!validRoot(value))throw Error('请输入普通库内文件夹路径');const file=fixed.value.trim();if(file&&(!this.app.vault.getAbstractFileByPath(file)||!this.app.vault.getAbstractFileByPath(file).extension?.match(/^(jpe?g|png|webp)$/i)))throw Error('固定图片需要有效的库内照片路径');await this.updateSettings({gallery:{enabled:enabled.value==='yes',folder:value,fixedFile:file,height:D.clamp(Number(height.value),120,420,210)}},token);m.close();}catch(e){error.textContent=e.message;}},'mod-cta');
 }).open();}
 async importScenery(files){const folder=this.galleryFolder();await this.store.folders();await this.store.ensureFolder(folder);for(const file of files){if(!/\.(jpe?g|png|webp)$/i.test(file.name)||file.size>10000000)throw Error('仅支持小于 10 MB 的 JPG、PNG、WebP 照片');const name=file.name.replace(/[\\/:*?"<>|]/g,'_');const path=folder+'/'+name;if(this.app.vault.getAbstractFileByPath(path))continue;await this.app.vault.createBinary(path,await file.arrayBuffer());}this.refresh();}
 async backupMarkdown(checkActive=()=>{}){
  const base=this.store.root+'/整理备份',files=this.app.vault.getMarkdownFiles().filter(f=>!f.path.startsWith(base+'/'));
  if(files.reduce((n,f)=>n+(f.stat?.size||0),0)>30*1024*1024)throw Error('笔记快照超过 30 MB，请先缩小整理范围或手动备份');
  const snapshot=base+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+C.uid().slice(0,8),prepared=[];let bytes=0;
  for(const file of files){checkActive();const text=await this.app.vault.read(file);bytes+=text.length*2;if(bytes>60*1024*1024)throw Error('笔记快照过大，请先手动备份');prepared.push({file,text});}
  const dirs=new Set();const ensure=async path=>{let current='';for(const part of path.split('/')){current=current?current+'/'+part:part;if(!dirs.has(current)){await this.store.ensureFolder(current);dirs.add(current);}}};await ensure(snapshot);
  const manifest={createdAt:new Date().toISOString(),scope:'Markdown notes only; attachments are not included',files:[]};
  for(const{file,text}of prepared){checkActive();const target=snapshot+'/'+file.path;await ensure(target.slice(0,target.lastIndexOf('/')));await this.app.vault.create(target,text);manifest.files.push({source:file.path,backup:target});}
  await this.app.vault.create(snapshot+'/manifest.json',JSON.stringify(manifest,null,2));return snapshot;
 }
 async downloadScenery(){
  if(this.downloadingScenery)throw Error('图库正在下载');this.downloadingScenery=true;
  try{const base='https://github.com/w3330442790-sys/obsidian-todo-dashboard/releases/download/0.2.0/';const response=await requestUrl({url:base+'SOURCE_LICENSES.json'});const list=response.json;if(!Array.isArray(list)||list.length>20)throw Error('图库清单格式不正确');const folder=this.galleryFolder();await this.store.folders();await this.store.ensureFolder(folder);
   for(const entry of list){if(!/^[\w-]+\.(jpg|png|webp)$/.test(entry.file))throw Error('图库文件名不正确');const path=folder+'/'+entry.file;if(this.app.vault.getAbstractFileByPath(path))continue;const image=await requestUrl({url:base+entry.file});if(image.arrayBuffer.byteLength>10000000)throw Error('图库照片超过大小限制');await this.app.vault.createBinary(path,image.arrayBuffer);}
   const path=folder+'/SOURCE_LICENSES.json',text=JSON.stringify(list,null,2),file=this.app.vault.getAbstractFileByPath(path);if(!file)await this.app.vault.create(path,text);
   const md=folder+'/SOURCE_LICENSES.md';if(!this.app.vault.getAbstractFileByPath(md))await this.app.vault.create(md,'# 风景照片来源与许可\n\n'+list.map(e=>`- **${e.file}** — ${e.attribution||e.author}；${e.license}。\n  来源：${e.source_url}\n  许可：${e.license_url}\n  修改：${e.changes}`).join('\n\n'));
   await this.loadGalleryCredits();this.refresh();
  }finally{this.downloadingScenery=false;}
 }
 assistantPreferences(){const c=this.assistant;new SimpleModal(this,'Codex 本机连接设置',(root,m)=>{V.el(root,'p','td-muted','Windows 使用本机 Codex CLI 官方登录。账号凭据不写入笔记库。安卓不能运行本机 Windows CLI。');const path=formField(root,'codex.exe 的完整路径（留空自动查找）','text',c.state.executable);const error=V.el(root,'p','td-error');V.button(root,'保存连接设置',()=>{if(c.state.busy){error.textContent='请先停止当前回复';return;}c.close();c.state.executable=path.value.trim();c.persist();this.refresh();m.close();},'mod-cta');}).open();}
 editList(list){
  const token=this.store.token('settings','settings');new SimpleModal(this,list?'编辑清单':'创建清单',(root,m)=>{
   const name=formField(root,'清单名称','text',list?.name||'');const color=formField(root,'颜色','color',list?.color||C.PALETTE[(this.store.settings.lists||[]).length%C.PALETTE.length]);
   const palette=V.el(root,'div','td-palette');for(const shade of C.PALETTE){const b=V.button(palette,'',()=>{color.value=shade;},'td-swatch');b.style.background=shade;b.setAttribute('aria-label',shade);}
   const error=V.el(root,'p','td-error');V.button(root,'保存清单',async()=>{try{if(!name.value.trim())throw Error('请输入名称');const lists=clone(this.store.settings.lists||[]),value={id:list?.id||C.uid(),name:name.value.trim(),color:color.value};const i=lists.findIndex(x=>x.id===value.id);if(i<0)lists.push(value);else lists[i]=value;await this.updateSettings({lists},token);m.close();}catch(e){error.textContent=e.message;}},'mod-cta');
  }).open();
 }
 editStat(){const token=this.store.token('settings','settings');new SimpleModal(this,'添加笔记统计',(root,m)=>{
  const kind=formSelect(root,'统计类型',[['folder','文件夹（包括子文件夹）'],['tag','标签（精确匹配）']],'folder'),value=formField(root,'文件夹路径或标签','text','');value.placeholder='例如：科研 或 #学习';const error=V.el(root,'p','td-error');
  V.button(root,'添加统计',async()=>{try{const v=value.value.trim().replace(/^\/+|\/+$/g,'');if(!v)throw Error('请输入文件夹或标签');await this.updateSettings({stats:[...(this.store.settings.stats||[]),{id:C.uid(),kind:kind.value,value:v}]},token);m.close();}catch(e){error.textContent=e.message;}},'mod-cta');
 }).open();}
 showNotes(title,notes){new SimpleModal(this,title,(root)=>{if(!notes.length)V.empty(root,'没有匹配的笔记');for(const f of notes)V.button(root,f.path,()=>this.app.workspace.openLinkText(f.path,'',false),'td-note');}).open();}
 showErrors(){new SimpleModal(this,'需要检查的数据文件',root=>{for(const e of [...this.store.errors,...(this.journal?.errors||[]),...(this.courses?.errors||[])]){V.el(root,'p','td-error',e.path+'：'+e.message);V.button(root,'打开文件',()=>this.app.workspace.openLinkText(e.path,'',false),'td-link');}}).open();}
 preferences(){const token=this.store.token('settings','settings');new SimpleModal(this,'偏好设置',(root,m)=>{
  const auto=V.el(root,'label','td-toggle'),check=V.el(auto,'input','');check.type='checkbox';check.checked=this.local.autoOpen!==false;V.el(auto,'span','','启动时自动进入首页');
  const excludes=formField(root,'最近笔记排除文件夹（每行一个）','textarea',(this.store.settings.excludedFolders||[]).join('\n'));
  V.el(root,'p','td-muted','数据目录：'+this.store.root+'。此目录中的数据笔记自动排除于笔记统计和最近笔记。');
  V.el(root,'p','td-muted','EasySync：请同步整个数据目录及课程笔记/。运行中计时器保留在本机，结束后专注记录参与同步。');
  const error=V.el(root,'p','td-error');V.button(root,'保存设置',async()=>{try{await this.updateSettings({excludedFolders:excludes.value.split('\n').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean)},token);this.local.autoOpen=check.checked;await this.saveData(this.local);m.close();}catch(e){error.textContent=e.message;}},'mod-cta');
 }).open();}
 persistTimer(){try{if(this.timer){this.timer.savedAt=Date.now();localStorage.setItem(this.localKey,JSON.stringify(this.timer));}else localStorage.removeItem(this.localKey);}catch{new Notice('无法保存本机计时状态，请检查存储空间');}}
 async startTimer(task){if(this.timer){new Notice('请先结束当前计时，再开始另一个任务');return;}this.timer={id:C.uid(),taskId:task?.id||null,title:task?.title||'自由专注',accumulated:0,runningSince:Date.now(),segments:[],startedAt:Date.now()};this.persistTimer();this.refresh();}
 async toggleTimer(){if(!this.timer||this.finishing)return;const now=Date.now();if(this.timer.runningSince!=null){this.timer.accumulated=C.elapsed(this.timer,now);this.timer.segments.push({start:this.timer.runningSince,end:now});this.timer.runningSince=null;}else this.timer.runningSince=now;this.persistTimer();this.refresh();}
 async finishTimer(){if(!this.timer||this.finishing)return;this.finishing=true;try{if(this.timer.runningSince!=null){const now=Date.now();this.timer.accumulated=C.elapsed(this.timer,now);this.timer.segments.push({start:this.timer.runningSince,end:now});this.timer.runningSince=null;this.persistTimer();}this.refresh();const record={id:this.timer.id,title:this.timer.title,taskId:this.timer.taskId,segments:clone(this.timer.segments),duration:this.timer.accumulated,endedAt:Date.now()};await this.store.saveSession(record);this.timer=null;this.persistTimer();new Notice('专注记录已保存到时间轴');}finally{this.finishing=false;this.refresh();}}
 reviewTimer(cutoff){
  if(!this.timer||this.recovering)return;this.recovering=true;const t=this.timer,wasRunning=t.runningSince!=null,now=Date.now();
  if(wasRunning){const end=Math.max(t.runningSince,Math.min(cutoff,now));t.accumulated=C.elapsed(t,end);t.segments.push({start:t.runningSince,end});t.runningSince=null;this.persistTimer();}
  const modal=new SimpleModal(this,'恢复上次专注',(root,m)=>{V.el(root,'p','',`任务：${t.title}，已记录 ${C.duration(t.accumulated)}。当前已暂停。`);
   if(wasRunning){V.el(root,'p','td-muted','是否计入离开应用期间的时间？');V.button(root,'计入并继续',()=>{if(this.timer!==t)return m.close();const start=Math.max(cutoff,t.startedAt);t.segments.push({start,end:now});t.accumulated+=Math.max(0,now-start);t.runningSince=Date.now();this.persistTimer();this.refresh();m.close();},'mod-cta');}
   V.button(root,'保持暂停',()=>{this.refresh();m.close();});V.button(root,'结束并保存',()=>this.run(async()=>{await this.finishTimer();m.close();}));
  });const baseClose=modal.onClose.bind(modal);modal.onClose=()=>{this.recovering=false;baseClose();this.refresh();};modal.open();
 }
}
module.exports=TodoPlugin;
