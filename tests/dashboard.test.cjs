const{test}=require('node:test'),assert=require('node:assert/strict');const D=require('../src/dashboard.cjs');
test('daily landscape is stable and advances next day',()=>{const files=['b.jpg','a.jpg','c.jpg'];assert.equal(D.dailyImage(files,'2026-10-27'),D.dailyImage(files,'2026-10-27'));assert.notEqual(D.dailyImage(files,'2026-10-27'),D.dailyImage(files,'2026-10-28'));assert.equal(D.dailyImage([],'2026-10-27'),null);assert.equal(D.dailyImage(files,'2026-10-27','b.jpg'),'b.jpg');});
test('layout preserves known order and appends new modules once',()=>{const x=D.normalizeLayout({order:['recent','recent','bad','today']});assert.deepEqual(x.order.slice(0,2),['recent','today']);assert.equal(new Set(x.order).size,D.WIDGETS.length);assert.ok(x.order.includes('inspiration'));assert.ok(x.order.includes('reflection'));});
test('layout spans round and clamp to 1–12 and devices stay separate',()=>{const x=D.normalizeLayout({desktop:{recent:{span:3,height:90000},today:{span:4.6},focus:{span:0},custom:{span:100}},tablet:{recent:{span:12,height:220}}});assert.equal(x.desktop.recent.span,3);assert.equal(x.desktop.today.span,5);assert.equal(x.desktop.focus.span,1);assert.equal(x.desktop.custom.span,12);assert.equal(x.desktop.recent.height,900);assert.equal(x.tablet.recent.height,220);assert.equal(x.tablet.recent.span,12);});
test('recommended defaults are compact and legacy 6/12 values are preserved',()=>{const x=D.normalizeLayout({desktop:{focus:{span:12},today:{span:6}}});assert.equal(x.desktop.focus.span,12);assert.equal(x.desktop.today.span,6);const d=D.normalizeLayout({});assert.equal(d.desktop.focus.span,3);assert.equal(d.desktop.inspiration.span,4);assert.equal(d.desktop.reflection.span,4);assert.equal(d.desktop.stats.span,12);assert.ok(d.desktop.focus.height<=300);});
test('module move is immutable and supports before after and end',()=>{const x=D.normalizeLayout({});const y=D.moveWidget(x,'recent','stats');assert.equal(y.order[0],'recent');assert.equal(x.order[0],'stats');const z=D.moveWidgetAfter(x,'stats','today');assert.equal(z.order.indexOf('stats'),z.order.indexOf('today')+1);assert.equal(D.moveWidget(x,'stats',null).order.at(-1),'stats');assert.deepEqual(D.moveWidgetAfter(x,'stats','stats'),x);});
test('malformed layout falls back to defaults',()=>{assert.equal(D.normalizeLayout('bad').order.length,D.WIDGETS.length);assert.equal(D.normalizeLayout({desktop:[]}).desktop.recent.span,5);assert.equal(D.normalizeLayout({desktop:{focus:{span:'bad'}}}).desktop.focus.span,3);});
const items=[{id:'a',left:0,right:100,top:0,bottom:100},{id:'b',left:120,right:220,top:0,bottom:100},{id:'c',left:0,right:220,top:120,bottom:220}];
test('drop placement resolves before, after, row gaps, and final empty space',()=>{assert.deepEqual(D.dropTarget(items,20,40),{id:'a',after:false,edge:'left'});assert.deepEqual(D.dropTarget(items,210,40),{id:'b',after:true,edge:'right'});assert.deepEqual(D.dropTarget(items,80,115),{id:'c',after:false,edge:'top'});assert.deepEqual(D.dropTarget(items,30,300),{id:'c',after:true,edge:'bottom'});assert.equal(D.dropTarget([],0,0),null);});
test('resize snaps each grid column, bounds heights and keeps narrow width',()=>{assert.deepEqual(D.resizeSize({span:4,height:240,width:400},100,50,1200,0,false),{span:5,height:290});assert.deepEqual(D.resizeSize({span:4,height:240,width:400},1200,-300,1200,0,false),{span:12,height:180});assert.deepEqual(D.resizeSize({span:4,height:240,width:400},300,10,500,12,true),{span:4,height:250});});
test('compact preset aligns two 5/4/3 desktop rows with short strips and tablet pairs',()=>{const x=D.compactLayout();assert.deepEqual(x.order,['stats','today','inspiration','focus','recent','reflection','custom','plans','week','trend','assistant']);assert.deepEqual(['today','inspiration','focus'].map(id=>x.desktop[id].span),[5,4,3]);assert.deepEqual(['recent','reflection','custom'].map(id=>x.desktop[id].span),[5,4,3]);assert.ok(x.desktop.stats.height<80);assert.ok(x.desktop.assistant.height<80);assert.equal(x.tablet.today.span,6);assert.equal(x.tablet.recent.span,6);});
test('compact migration is idempotent, preserves data and restores exact old layout/banner preferences',()=>{const old={lists:[{id:'x'}],stats:[],dashboard:{order:['recent','focus'],desktop:{focus:{span:7,height:410}}},gallery:{height:310,enabled:false,fixedFile:'mine.jpg'}};const original=JSON.parse(JSON.stringify(old)),next=D.migrateCompactSettings(old);assert.deepEqual(old,original);assert.equal(next.gallery.height,120);assert.equal(next.gallery.enabled,false);assert.equal(next.gallery.fixedFile,'mine.jpg');assert.deepEqual(next.lists,old.lists);assert.equal(D.migrateCompactSettings(next),next);const restored=D.restoreCompactSettings(next);assert.deepEqual(restored.dashboard,old.dashboard);assert.deepEqual(restored.gallery,old.gallery);assert.equal(restored.compactHome.active,false);assert.equal(D.migrateCompactSettings(restored),restored);assert.equal(D.applyCompactSettings(restored).compactHome.active,true);});
test('short strip sizes survive normalization while normal cards retain readable minima',()=>{const x=D.normalizeLayout({desktop:{stats:{height:60},assistant:{height:66},recent:{height:10}}});assert.equal(x.desktop.stats.height,60);assert.equal(x.desktop.assistant.height,66);assert.equal(x.desktop.recent.height,180);});
test('re-entering compact mode backs up intervening legacy edits without replacing active backup',()=>{const first=D.migrateCompactSettings({dashboard:{desktop:{today:{span:7,height:400}}},gallery:{height:310}}),legacy=D.restoreCompactSettings(first);legacy.dashboard.desktop.today.height=500;legacy.gallery.height=350;const second=D.applyCompactSettings(legacy),again=D.applyCompactSettings(second),restored=D.restoreCompactSettings(again);assert.equal(restored.dashboard.desktop.today.height,500);assert.equal(restored.gallery.height,350);});
test('new dashboards show planning by default and honor explicit opt-out',()=>{
 assert.equal(D.showPlanning({}),true);
 assert.equal(D.showPlanning({planningWidgets:false}),false);
 assert.ok(D.compactLayout().order.indexOf('plans')<D.compactLayout().order.indexOf('assistant'));
});
test('completion trend uses actual completion date and includes today and the previous 13 days',()=>{
 const trend=D.completionTrend([
  {status:'done',date:'2026-09-01',completedAt:'2026-10-25'},
  {status:'done',completedAt:'2026-11-07'},
  {status:'done',completedAt:'2026-11-07'},
  {status:'done',completedAt:'2026-11-07',deleted:true},
  {status:'open',completedAt:'2026-11-07'},
  {status:'done',completedAt:'2026-10-24'},
  {status:'done',completedAt:'2026-11-08'},
  {status:'done',date:'2026-11-06'}
 ],'2026-11-07');
 assert.equal(trend.length,14);
 assert.deepEqual(trend[0],{date:'2026-10-25',count:1});
 assert.deepEqual(trend.at(-2),{date:'2026-11-06',count:0});
 assert.deepEqual(trend.at(-1),{date:'2026-11-07',count:2});
 assert.equal(trend.reduce((sum,day)=>sum+day.count,0),3);
});
test('bright workspace presets are persisted by the existing theme normalizer',()=>{
 for(const color of ['honey','strawberry','mint','grape']){
  assert.equal(D.normalizeTheme({color,style:'soft'}).color,color);
 }
});
test('day and night preferences are independent and legacy colors get matching night defaults',()=>{
 assert.deepEqual(D.normalizeTheme({color:'mint',style:'soft'}),{color:'mint',nightColor:'firefly',style:'soft'});
 assert.deepEqual(D.normalizeTheme({color:'honey',nightColor:'rose-night',style:'minimal'}),{color:'honey',nightColor:'rose-night',style:'minimal'});
 assert.deepEqual(D.normalizeTheme({color:'moon',nightColor:'strawberry'}),{color:'classic',nightColor:'moon',style:'classic'});
});
test('switching mode applies the saved palette of that mode',()=>{
 let dark=false;
 const target={dataset:{},ownerDocument:{body:{classList:{contains:()=>dark}}}};
 const theme={color:'strawberry',nightColor:'firefly',style:'soft'};
 D.applyTheme(target,theme);
 assert.deepEqual(target.dataset,{tdMode:'day',tdColor:'strawberry',tdStyle:'soft'});
 dark=true;
 D.applyTheme(target,theme);
 assert.deepEqual(target.dataset,{tdMode:'night',tdColor:'firefly',tdStyle:'soft'});
});
test('theme illustration matches a palette or rotates within the current mode',()=>{
 const art=[
  {file:'d1.webp',mode:'day',palettes:['honey']},
  {file:'d2.webp',mode:'day',palettes:['strawberry']},
  {file:'n1.webp',mode:'night',palettes:['moon']}
 ];
 assert.equal(D.themeIllustration(art,'2026-11-07','day','strawberry').file,'d2.webp');
 assert.notEqual(D.themeIllustration(art,'2026-11-07','day','classic'),D.themeIllustration(art,'2026-11-08','day','classic'));
 assert.equal(D.themeIllustration(art,'2026-11-07','night','firefly').file,'n1.webp');
 assert.equal(D.themeIllustration(art.slice(0,2),'2026-11-07','night','moon'),undefined);
});
