const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/core.cjs');
function plugin(){const m={exports:{}};const load=vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(require.resolve('../src/plugin.cjs'),'utf8')+'\n})',{localStorage:{setItem(){},removeItem(){}},console,setTimeout,clearTimeout});load(id=>id==='obsidian'?{Plugin:class{},Modal:class{},ItemView:class{},PluginSettingTab:class{},Notice:class{}}:require('../src/'+id.replace('./','')),m,m.exports);const p=new m.exports();p.views=new Set();p.store={tasks:new Map(),errors:[],saveTask:async t=>{p.store.tasks.set(t.id,t);},ensureTask:async t=>{if(!p.store.tasks.has(t.id))p.store.tasks.set(t.id,t);}};return p;}
test('editing completed recurrence does not generate a second open instance',async()=>{const p=plugin(),t={id:'r',title:'阅读',status:'open',date:C.localDate(),repeat:'daily'};p.store.tasks.set(t.id,t);await p.toggleTask(t);const done=p.store.tasks.get('r');await p.saveTask({...done,repeat:'weekly'});await p.repairRepeats();assert.equal([...p.store.tasks.values()].filter(t=>t.status==='open').length,1);});
test('timer cannot resume while finished session is being saved',async()=>{const p=plugin();p.timer={id:'t',title:'专注',runningSince:null,accumulated:1000,segments:[{start:1000,end:2000}]};let release;p.store.saveSession=async()=>new Promise(r=>release=r);const save=p.finishTimer();await Promise.resolve();await p.toggleTimer();assert.equal(p.timer.runningSince,null);release();await save;assert.equal(p.timer,null);});
test('repeat repair error is isolated and reported instead of aborting startup',async()=>{const p=plugin();p.store.tasks.set('r',{id:'r',title:'阅读',status:'done',date:C.localDate(),completedAt:C.localDate(),repeat:'daily'});p.store.ensureTask=async()=>{throw Error('损坏的后续文件');};await p.repairRepeats();assert.equal(p.store.errors.length,1);});
test('unchanged file reload does not rebuild an editing dashboard',async()=>{const p=plugin();p.store.snapshots=new Map([['settings','same']]);p.store.load=async()=>{};p.repairRepeats=async()=>{};p.loadGalleryCredits=async()=>{};let renders=0;p.refresh=()=>renders++;await p.reload();assert.equal(renders,0);});
test('daily tick refreshes scenery once when local date advances',()=>{const p=plugin();p.lastDay='2026-10-26';let renders=0;p.refresh=()=>renders++;p.tick('2026-10-27');p.tick('2026-10-27');assert.equal(renders,1);});
for(const mode of ['complete','repair'])test(`repeat marker preserves edits made while ${mode} awaits successor creation`,async()=>{
 const p=plugin();let version=0,release;
 p.store.token=()=>version;
 p.store.saveTask=async(t,expected)=>{if(expected!==undefined&&expected!==version)throw Error('stale revision');p.store.tasks.set(t.id,t);version++;};
 p.store.ensureTask=async t=>{await new Promise(r=>release=r);p.store.tasks.set(t.id,t);};
 const t={id:'r',title:'Original',status:mode==='complete'?'open':'done',date:C.localDate(),completedAt:C.localDate(),repeat:'daily'};p.store.tasks.set(t.id,t);
 const pending=mode==='complete'?p.toggleTask(t):p.repairRepeats();await new Promise(r=>setImmediate(r));
 await p.saveTask({...p.store.tasks.get('r'),title:'Edited while saving'});release();
 if(mode==='complete')await assert.rejects(pending,/stale revision/);else await pending;
 assert.equal(p.store.tasks.get('r').title,'Edited while saving');
});
test('timeline current-time markers update on the periodic tick',()=>{const p=plugin();p.lastDay=C.localDate();const line={dataset:{hourHeight:'48'},style:{}};p.views.add({contentEl:{querySelectorAll:selector=>selector==='[data-now-line]'?[line]:[]}});p.store.sessions=new Map();p.tick();assert.ok(Number.parseFloat(line.style.top)>=0);});
