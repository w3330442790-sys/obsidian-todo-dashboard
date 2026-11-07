'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('saved orders apply per folder, mix folders and files, and append newcomers',()=>{
 const {orderedItems}=require('../src/file-order.cjs');
 const entries=['Projects','Research','Inbox.md','New.md'].map(path=>({file:{path}}));
 assert.deepEqual(orderedItems(entries,['Inbox.md','Projects','Deleted.md']).map(x=>x.file.path),
  ['Inbox.md','Projects','Research','New.md']);
 assert.equal(orderedItems(entries,undefined),entries);
});

test('reordering a row before or after another preserves all other rows',()=>{
 const {moveItem}=require('../src/file-order.cjs');
 const original=['A','B','C'];
 assert.deepEqual(moveItem(original,'A','C',true),['B','C','A']);
 assert.deepEqual(moveItem(original,'C','A',false),['C','A','B']);
 assert.equal(moveItem(original,'A','missing',false),original);
 assert.deepEqual(original,['A','B','C']);
});

test('renaming a folder follows its subtree, and moving or deleting removes stale positions',()=>{
 const {remapOrders}=require('../src/file-order.cjs');
 const original={'/':['Projects','Inbox.md'],Projects:['Projects/Lab','Projects/a.md'],
  'Projects/Lab':['Projects/Lab/b.md'],Other:['Other/c.md']};
 assert.deepEqual(remapOrders(original,'Projects','Work'),{
  '/':['Work','Inbox.md'],Work:['Work/Lab','Work/a.md'],'Work/Lab':['Work/Lab/b.md'],Other:['Other/c.md']
 });
 assert.deepEqual(remapOrders(original,'Projects/a.md','Other/a.md').Projects,['Projects/Lab']);
 assert.deepEqual(remapOrders(original,'Projects',null),{'/':['Inbox.md'],Other:['Other/c.md']});
 assert.equal(remapOrders(original,'Unknown.md',null),original);
});

test('native explorer sorts only configured siblings and unpatches on disable',()=>{
 const {patchExplorerSort}=require('../src/file-order.cjs');
 const original=[{file:{path:'A'}},{file:{path:'note.md'}}];
 const view=Object.create({getSortedFolderItems(){return original;}});
 const restore=patchExplorerSort(view,path=>path==='/'?['note.md','A']:undefined);
 assert.deepEqual(view.getSortedFolderItems({path:'/'}),[original[1],original[0]]);
 assert.equal(view.getSortedFolderItems({path:'A'}),original);
 restore();
 assert.equal(Object.hasOwn(view,'getSortedFolderItems'),false);
 assert.equal(view.getSortedFolderItems({path:'/'}),original);
});
