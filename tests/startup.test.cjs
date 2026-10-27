const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/core.cjs');
function harness(){
 let layoutReady;const reads=[];const files=new Map([['Todo工作台/设置.md',C.encodeRecord('settings',{lists:[],stats:[]})]]);let indexed=false;
 class Plugin{async loadData(){return{};}registerView(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}registerEvent(){}registerInterval(){}registerDomEvent(){}}
 const stub={Plugin,ItemView:class{},Modal:class{},PluginSettingTab:class{},Notice:class{}};
 const module={exports:{}};vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(require.resolve('../src/plugin.cjs'),'utf8')+'\n})',{console,setTimeout,clearTimeout,document:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setInterval:()=>1})(id=>id==='obsidian'?stub:require('../src/'+id.replace('./','')),module,module.exports);
 const p=new module.exports();p.app={vault:{adapter:{stat:async path=>['Todo工作台','Todo工作台/tasks','Todo工作台/sessions'].includes(path)?{type:'folder'}:null},process:async(f,fn)=>files.set(f.path,fn(files.get(f.path))),getName:()=> 'startup-test',getFiles:()=>{reads.push('scan');return indexed?[...files.keys()].map(path=>({path,extension:'md'})):[];},getAbstractFileByPath:path=>indexed&&files.has(path)?{path}:null,read:async f=>files.get(f.path),createFolder:async()=>{throw Error('Folder already exists.');},on:()=>{}},metadataCache:{on:()=>{}},workspace:{onLayoutReady:fn=>{layoutReady=fn;}}};
 p.open=async()=>{};return{p,reads,ready:async()=>{indexed=true;await layoutReady();}};
}
test('plugin waits for layout readiness before scanning or initializing vault data',async()=>{const h=harness();await h.p.onload();assert.equal(h.reads.length,0);await h.ready();assert.ok(h.reads.length>0);assert.equal(h.p.ready,true);assert.equal(h.p.store.settings.compactHome.active,true);});
