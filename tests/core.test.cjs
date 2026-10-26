const {test} = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/core.cjs');
const task = (extra={}) => ({id:'a',title:'阅读',date:'2026-10-19',repeat:'none',quadrant:'persist',status:'open',subtasks:[{id:'s',title:'步骤',done:true}],...extra});
test('unfinished overdue task has no successor',()=>assert.equal(c.nextOccurrence(task({repeat:'daily'}),'2026-10-26'),null));
test('daily completion skips missed dates and resets subtasks',()=>{
 const next=c.completeTask(task({repeat:'daily'}),'2026-10-26').next;
 assert.equal(next.date,'2026-10-27'); assert.equal(next.subtasks[0].done,false);
 assert.equal(next.id,c.completeTask(task({repeat:'daily'}),'2026-10-26').next.id);
});
test('weekly completion keeps original weekday',()=>assert.equal(c.completeTask(task({repeat:'weekly'}),'2026-10-28').next.date,'2026-11-02'));
test('monthly anchor survives short February',()=>{
 let t=task({date:'2027-01-31',repeat:'monthly'});
 t=c.completeTask(t,'2027-01-31').next; assert.equal(t.date,'2027-02-28');
 t=c.completeTask(t,'2027-02-28').next; assert.equal(t.date,'2027-03-31');
});
test('no duplicate successor when task is already complete',()=>assert.equal(c.completeTask(task({status:'done',repeat:'daily'}),'2026-10-26').next,null));
test('one-time task completes without repeat',()=>assert.equal(c.completeTask(task(),'2026-10-26').next,null));
test('paused time is excluded from timer',()=>{
 assert.equal(c.elapsed({runningSince:1000,accumulated:500},3000),2500);
 assert.equal(c.elapsed({runningSince:null,accumulated:500},9000),500);
});
test('cross-midnight focus divided by local date',()=>{
 const start=new Date(2026,9,26,23,50).getTime(),end=new Date(2026,9,27,0,10).getTime();
 assert.equal(c.dailyDuration({segments:[{start,end}]},'2026-10-26'),600000);
 assert.equal(c.dailyDuration({segments:[{start,end}]},'2026-10-27'),600000);
});
test('record safely round trips multiline and special characters',()=>{
 const t=task({title:'冒号: #标签 [任务]',description:'一行\n第二行 ---\n"quoted"'});
 assert.deepEqual(c.decodeRecord(c.encodeRecord('task',t),'task'),t);
});
test('unknown schema is rejected',()=>assert.throws(()=>c.decodeRecord('---\ntodo_schema: 99\n---\n{}','task')));
test('malformed session and settings cannot crash views',()=>{
 assert.throws(()=>c.decodeRecord(c.encodeRecord('session',{id:'s',segments:'broken'}),'session'));
 assert.throws(()=>c.decodeRecord(c.encodeRecord('settings',{lists:'broken'}),'settings'));
});
test('invalid task calendar date is rejected',()=>assert.throws(()=>c.decodeRecord(c.encodeRecord('task',task({date:'2026-02-31'})),'task')));
test('invalid repeat anchors and completion dates are rejected',()=>{
 assert.throws(()=>c.decodeRecord(c.encodeRecord('task',task({completedAt:'broken'})),'task'));
 assert.throws(()=>c.decodeRecord(c.encodeRecord('task',task({repeatAnchor:0})),'task'));
});
test('tag matching is exact and folder includes descendants',()=>{
 assert.equal(c.matchesNote('课程/中医/笔记.md',['#学习'],{kind:'folder',value:'课程'}),true);
 assert.equal(c.matchesNote('课程外/笔记.md',[],{kind:'folder',value:'课程'}),false);
 assert.equal(c.matchesNote('笔记.md',['#学习/中医'],{kind:'tag',value:'学习'}),false);
});
