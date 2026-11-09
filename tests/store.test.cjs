const {test}=require('node:test');const assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
function vault(){const data=new Map();return {data,getFiles:()=>[...data.keys()].map(path=>({path,extension:'md'})),getAbstractFileByPath:p=>data.has(p)?{path:p}:null,read:async f=>data.get(f.path),createFolder:async()=>{},create:async(p,s)=>{if(data.has(p))throw Error('exists');data.set(p,s);return {path:p};},process:async(f,fn)=>{data.set(f.path,fn(data.get(f.path)));},modify:async(f,s)=>data.set(f.path,s)};}
const task={id:'a',title:'阅读',status:'open',date:'2026-10-26',repeat:'none'};
test('existing disk folders are accepted when vault cache has not indexed them',async()=>{const v=vault();v.createFolder=async()=>{throw Error('Folder already exists.');};v.adapter={stat:async()=>({type:'folder'})};const s=new Store(v,'Todo工作台');await s.folders();});
test('separate stores exchange task files without plugin configuration',async()=>{const v=vault(),a=new Store(v,'Todo工作台'),b=new Store(v,'Todo工作台');await a.load();await a.saveTask(task);await b.load();assert.equal(b.tasks.get('a').title,'阅读');});
test('external edit rejects stale write instead of overwriting it',async()=>{const v=vault(),a=new Store(v,'Todo工作台'),b=new Store(v,'Todo工作台');await a.load();await a.saveTask(task);await b.load();await b.saveTask({...task,title:'平板修改'});await assert.rejects(a.saveTask({...task,title:'电脑修改'}),/已被其他设备或窗口修改/);await a.load();assert.equal(a.tasks.get('a').title,'平板修改');});
test('invalid file preserved and reported',async()=>{const v=vault();v.data.set('Todo工作台/tasks/bad.md','unknown data');const s=new Store(v,'Todo工作台');await s.load();assert.equal(s.errors.length,1);assert.equal(v.data.get('Todo工作台/tasks/bad.md'),'unknown data');});
test('successor uses deterministic path and existing successor stays untouched',async()=>{const v=vault(),s=new Store(v,'Todo工作台');await s.load();await s.ensureTask(task);await s.ensureTask({...task,title:'duplicate'});assert.equal(v.data.size,1);assert.equal(s.tasks.get('a').title,'阅读');});
test('renamed files update in place using record ID',async()=>{const v=vault(),s=new Store(v,'Todo工作台');await s.load();await s.saveTask(task);const [p,t]=[...v.data][0];v.data.delete(p);v.data.set('Todo工作台/tasks/阅读.md',t);await s.load();await s.saveTask({...task,title:'更新'});assert.equal(v.data.size,1);});
test('reload keeps previous task index available until all reads finish',async()=>{const v=vault(),s=new Store(v,'Todo工作台');await s.load();await s.saveTask(task);const read=v.read;let release;v.read=async f=>{await new Promise(r=>release=r);return read(f);};const loading=s.load();await new Promise(r=>setImmediate(r));assert.equal(s.tasks.get('a')?.title,'阅读');release();await loading;});
test('queued refresh cannot silently upgrade a stale writers snapshot',async()=>{const v=vault(),s=new Store(v,'Todo工作台');await s.load();await s.saveTask(task);const path=s.paths.get('task:a');v.data.set(path,v.data.get(path).replace('阅读','平板更新'));const read=v.read;let release;v.read=async f=>{await new Promise(r=>release=r);return read(f);};const loading=s.load();await new Promise(r=>setImmediate(r));const saving=s.saveTask({...task,title:'旧窗口修改'});release();await loading;await assert.rejects(saving,/已被其他设备或窗口修改/);assert.match(v.data.get(path),/平板更新/);});

test('plans reload independently and reject stale edits',async()=>{const v=vault(),s=new Store(v,'Todo工作台'),other=new Store(v,'Todo工作台');const p={id:'p',title:'考试',status:'open',startDate:'2026-10-28',endDate:'2026-11-01',goals:[]};assert.equal(typeof s.savePlan,'function');await s.savePlan(p);await other.load();assert.equal(other.plans.get('p').title,'考试');await other.savePlan({...p,title:'已修改'});await assert.rejects(s.savePlan({...p,title:'过期修改'}),/已被其他设备或窗口修改/);assert.equal(s.sessions.size,0);});
test('invalid plans and schedules cannot be saved',async()=>{const s=new Store(vault(),'Todo工作台');await assert.rejects(s.savePlan({id:'bad',title:''}));await assert.rejects(s.saveTask({...task,endDate:'2026-10-25'}));});

test('literature metrics and reading progress sync as individual vault files',async()=>{
 const v=vault(),desktop=new Store(v,'Todo工作台'),tablet=new Store(v,'Todo工作台');
 const paper={id:'paper-a',title:'A fixture article',status:'reading',currentPage:4,totalPages:10,
  metrics:{impactFactor:3.9,jcrQuartile:'Q1',casMajor:'医学2区',metricsYear:2025}};
 await desktop.saveLiterature(paper);
 assert.ok(v.data.has('Todo工作台/literature/paper-a.md'));
 await tablet.load();
 assert.equal(tablet.literature.get(paper.id).metrics.impactFactor,3.9);
 assert.equal(tablet.literature.get(paper.id).currentPage,4);
 await tablet.saveLiterature({...tablet.literature.get(paper.id),currentPage:7},tablet.token('literature',paper.id));
 await assert.rejects(desktop.saveLiterature({...paper,currentPage:5}),/已被其他设备或窗口修改/);
 await desktop.load();
 assert.equal(desktop.literature.get(paper.id).currentPage,7);
 assert.equal(desktop.tasks.size,0);
});

test('EasyScholar results survive a vault reload and detach when the publication changes',async()=>{
 const v=vault(),desktop=new Store(v,'Todo工作台'),tablet=new Store(v,'Todo工作台');
 const ranks={publicationName:'Nature',checkedAt:'2026-11-09T04:00:00.000Z',official:{sci:'Q1',sciif:'8.2'},custom:[]};
 await desktop.saveLiterature({id:'a',title:'Article',publicationTitle:'Nature',metrics:{impactFactor:6},easyScholar:ranks});
 await tablet.load();
 const saved=tablet.literature.get('a');
 assert.deepEqual(saved.easyScholar,ranks);
 assert.equal(saved.metrics.impactFactor,6);
 await tablet.saveLiterature({...saved,publicationTitle:'Science'},tablet.token('literature','a'));
 await desktop.load();
 assert.equal(desktop.literature.get('a').easyScholar,null);
 assert.equal(desktop.literature.get('a').metrics.impactFactor,6);
});
