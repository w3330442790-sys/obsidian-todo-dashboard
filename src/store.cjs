'use strict';
const {encodeRecord,decodeRecord}=require('./core.cjs');
class Store{
 constructor(vault,root){this.vault=vault;this.root=root;this.tasks=new Map();this.sessions=new Map();this.settings={};this.snapshots=new Map();this.paths=new Map();this.errors=[];this.queue=Promise.resolve();}
 async folders(){let path='';for(const part of this.root.split('/')){path=path?path+'/'+part:part;if(!this.vault.getAbstractFileByPath(path)){try{await this.vault.createFolder(path);}catch(e){if(!this.vault.getAbstractFileByPath(path))throw e;}}}for(const sub of ['tasks','sessions']){const p=this.root+'/'+sub;if(!this.vault.getAbstractFileByPath(p)){try{await this.vault.createFolder(p);}catch(e){if(!this.vault.getAbstractFileByPath(p))throw e;}}}}
 enqueue(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
 async load(){return this.enqueue(async()=>{
  const tasks=new Map(),sessions=new Map(),paths=new Map(),snapshots=new Map(),errors=[];let settings={};
  for(const file of this.vault.getFiles().filter(f=>f.path.startsWith(this.root+'/')&&f.extension==='md')){
   const kind=file.path.startsWith(this.root+'/tasks/')?'task':file.path.startsWith(this.root+'/sessions/')?'session':file.path===this.root+'/设置.md'?'settings':null;
   if(!kind)continue;
   try{const raw=await this.vault.read(file),r=decodeRecord(raw,kind),key=kind+':'+(r.id||'settings');
    if(paths.has(key))throw Error('发现重复 ID，请检查同步冲突副本');
    snapshots.set(file.path,raw);paths.set(key,file.path);
    if(kind==='task')tasks.set(r.id,r);else if(kind==='session')sessions.set(r.id,r);else settings=r;
   }catch(e){errors.push({path:file.path,message:e.message});}
  }
  Object.assign(this,{tasks,sessions,paths,snapshots,errors,settings});
 });}
 token(kind,id){return this.snapshots.get(this.paths.get(kind+':'+id));}
 async write(kind,record,expected){
  const initialId=record.id||'settings';
  const initialPath=this.paths.get(kind+':'+initialId)||(kind==='settings'?this.root+'/设置.md':`${this.root}/${kind==='task'?'tasks':'sessions'}/${initialId}.md`);
  const before=expected===undefined?this.snapshots.get(initialPath):expected;
  return this.enqueue(async()=>{
  await this.folders();
  const id=record.id||'settings';
  if(!/^[\w-]+$/.test(id))throw Error('记录 ID 不合法');
  const path=this.paths.get(kind+':'+id)||(kind==='settings'?this.root+'/设置.md':`${this.root}/${kind==='task'?'tasks':'sessions'}/${id}.md`);
  const raw=encodeRecord(kind,record),file=this.vault.getAbstractFileByPath(path);
  if(file){
   if(before===undefined)throw Error('记录已被其他设备或窗口修改，请刷新后重试');
   await this.vault.process(file,current=>{if(current!==before)throw Error('记录已被其他设备或窗口修改，请重新打开后编辑');return raw;});
  }else{
   if(before!==undefined)throw Error('记录已被其他设备删除或移动，请刷新后重试');
   await this.vault.create(path,raw);
  }
  this.snapshots.set(path,raw);this.paths.set(kind+':'+id,path);
  if(kind==='task')this.tasks.set(id,record);else if(kind==='session')this.sessions.set(id,record);else this.settings=record;
  return record;
 });}
 saveTask(t,expected){return this.write('task',t,expected);}
 saveSession(s){return this.write('session',s);}
 saveSettings(s,expected){return this.write('settings',s,expected);}
 async ensureTask(t){if(this.tasks.has(t.id))return this.tasks.get(t.id);const p=`${this.root}/tasks/${t.id}.md`;if(this.vault.getAbstractFileByPath(p)){await this.load();if(this.tasks.has(t.id))return this.tasks.get(t.id);throw Error('同名任务文件无法解析，已保留原文件');}return this.saveTask(t);}
}
module.exports={Store};
