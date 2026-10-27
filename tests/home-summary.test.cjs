'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core.cjs');
const {renderReflectionSummary,renderAssistantSummary}=require('../src/home-summary.cjs');

function fixture(){
 const nodes=[];
 function el(parent,tag,className='',text=''){const n={tag,className,textContent:text,children:[],classList:{add(value){n.className+=' '+value;}},setAttribute(){}};parent?.children.push(n);nodes.push(n);return n;}
 const ui={el,button(parent,text,click,className){const n=el(parent,'button',className,text);n.click=click;return n;},panel(parent,title,header){const box=el(parent,'section','td-panel');header?.(el(box,'header','',title));return box;}};
 const root={children:[]},calls=[],today=C.localDate(),now=C.parseDate(today).getTime()+3600000;
 const plugin={store:{tasks:new Map([['today',{status:'done',completedAt:today}],['old',{status:'done',completedAt:C.addDays(today,-1)}],['deleted',{status:'done',completedAt:today,deleted:true}]]),sessions:new Map([['focus',{id:'focus',duration:60000,segments:[{start:now,end:now+60000}]}]])},journal:{inspirations:new Map([['i',{createdAt:new Date(now).toISOString()}]]),reflections:new Map()},assistant:{desktop:true,state:{connected:false,busy:false,status:'未连接本机 Codex',draft:'keep draft',messages:[{role:'user',text:'keep history'}]},subscribe(view,paint){this.listener=paint;},unsubscribe(view){calls.push('unsubscribe');this.listener=null;}},notes(){return []}};
 const view={plugin,state:{journal:{text:'保留草稿',busy:false}},go(page){calls.push(page);},contentEl:{querySelector(selector){calls.push(selector);return{scrollIntoView(){calls.push('scroll');},focus(){calls.push('focus');}};}}};
 return{view,root,ui,nodes,calls,plugin,find:text=>nodes.find(n=>n.textContent===text)};
}
test('reflection overview shows today facts and latest saved excerpt without full editor',()=>{
 const f=fixture();f.plugin.journal.reflections.set('old',{createdAt:'2026-01-01',updatedAt:'2026-01-01',text:'旧记录'});f.plugin.journal.reflections.set('new',{createdAt:'2026-01-02',updatedAt:'2026-01-03',text:'新记录\n'+ '长'.repeat(120)});
 renderReflectionSummary(f.view,f.root,f.ui);
 assert.ok(f.nodes.some(n=>n.className.includes('td-home-reflection')));
 assert.ok(f.nodes.some(n=>/完成 1 项.*专注 00:01:00.*灵感 1 条/.test(n.textContent)));
 const excerpt=f.nodes.find(n=>n.className==='td-home-reflection-excerpt');assert.match(excerpt.textContent,/^新记录 /);assert.ok(Array.from(excerpt.textContent).length<=90);
 assert.equal(f.nodes.some(n=>['textarea','input','select','pre'].includes(n.tag)),false);
});
test('both reflection entry points navigate then focus without changing draft or starting jobs',()=>{
 for(const label of ['写复盘','AI 复盘']){const f=fixture(),before=JSON.stringify(f.view.state);f.plugin.generateJob=()=>assert.fail('must not start model');renderReflectionSummary(f.view,f.root,f.ui);f.find(label).click();assert.deepEqual(f.calls,['journal','.td-review-text','scroll','focus']);assert.equal(JSON.stringify(f.view.state),before);}
});
test('reflection busy state is visible and missing state does not initialize a draft',()=>{
 const f=fixture();f.view.state.journal.busy=true;renderReflectionSummary(f.view,f.root,f.ui);assert.ok(f.nodes.some(n=>/正在生成/.test(n.textContent)));
 const g=fixture();delete g.view.state.journal;delete g.view.contentEl;renderReflectionSummary(g.view,g.root,g.ui);assert.equal(g.view.state.journal,undefined);g.find('写复盘').click();assert.deepEqual(g.calls,['journal']);
});
test('assistant shortcuts update live connection and busy status while preserving conversation',()=>{
 const f=fixture(),before=JSON.stringify(f.plugin.assistant.state);const cleanup=renderAssistantSummary(f.view,f.root,f.ui);
 assert.ok(f.nodes.some(n=>n.className.includes('td-assistant-shortcuts')));assert.ok(f.nodes.some(n=>/未连接/.test(n.textContent)));assert.equal(f.nodes.some(n=>n.tag==='textarea'||n.className.includes('td-chat-log')),false);
 f.find('打开对话').click();f.find('整理课程').click();assert.deepEqual(f.calls,['assistant','courses']);assert.equal(JSON.stringify(f.plugin.assistant.state),before);
 f.plugin.assistant.state.connected=true;f.plugin.assistant.state.busy=true;f.plugin.assistant.state.status='正在处理';f.plugin.assistant.listener();assert.ok(f.nodes.some(n=>/已连接.*处理中/.test(n.textContent)));
 cleanup();assert.equal(f.plugin.assistant.listener,null);assert.equal(f.calls.at(-1),'unsubscribe');
});
test('assistant shortcut handles unavailable or mobile controller',()=>{
 const f=fixture();f.plugin.assistant.desktop=false;renderAssistantSummary(f.view,f.root,f.ui);assert.ok(f.nodes.some(n=>/Windows/.test(n.textContent)));
 const g=fixture();delete g.plugin.assistant;assert.doesNotThrow(()=>renderAssistantSummary(g.view,g.root,g.ui));
});
