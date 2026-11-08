'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {importLiteraturePdf}=require('../src/literature-pdf.cjs');
const {translationPrompt,excerptMarkdown}=require('../src/literature-reader.cjs');
const {pdfFixture}=require('./fixtures/pdf-fixture.cjs');

function fixture(){
  const files=new Map(), literature=new Map(),root='Todo工作台';
  const plugin={app:{vault:{
    getFiles:()=>[...files.values()],
    getAbstractFileByPath:path=>files.get(path),
    createBinary:async(path,data)=>{assert.equal(files.has(path),false);files.set(path,{path,data,extension:'pdf'});},
    readBinary:async file=>file.data
  }},store:{root,literature,ensureFolder:async()=>{},
    saveLiterature:async(record,token)=>{if(literature.has(record.id)&&record.id==='existing')assert.equal(token,'original');literature.set(record.id,record);return record;}
  }};
  return {plugin,files,literature};
}
const upload=(name,buffer)=>({name,size:buffer.length,arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)});

test('imports a PDF once by content and attaches the same bytes to an existing citation',async()=>{
  const {plugin,files,literature}=fixture();
  const buffer=pdfFixture('First page of a synthetic literature PDF.');
  const first=await importLiteraturePdf(plugin,upload('Study.pdf',buffer));
  assert.match(first.paper.pdfPath,/^Todo工作台\/literature-pdfs\/Study-[a-f0-9]{64}\.pdf$/);
  assert.equal(first.paper.title,'Study');
  const second=await importLiteraturePdf(plugin,upload('Renamed.pdf',buffer));
  assert.equal(second.duplicate,true);
  assert.equal(second.paper.id,first.paper.id);
  const paper={id:'existing',title:'Existing citation',status:'reading',currentPage:2,collections:['Clinical'],metrics:{impactFactor:3.9}};
  literature.set(paper.id,paper);
  const attached=await importLiteraturePdf(plugin,upload('Third.pdf',buffer),{paper,token:'original'});
  assert.equal(attached.paper.pdfPath,first.paper.pdfPath);
  assert.equal(attached.paper.currentPage,2);
  assert.deepEqual(attached.paper.collections,['Clinical']);
  assert.equal(attached.paper.metrics.impactFactor,3.9);
  assert.equal(files.size,1);
});

test('rejects non-PDF content before any vault write',async()=>{
  const {plugin,files}=fixture();
  await assert.rejects(importLiteraturePdf(plugin,upload('Fake.pdf',Buffer.from('not pdf'))),/可识别的 PDF/);
  await assert.rejects(importLiteraturePdf(plugin,{name:'Large.pdf',size:51*1024*1024}),/50 MB/);
  assert.equal(files.size,0);
});

test('translation is bounded to the supplied excerpt or page',()=>{
  assert.match(translationPrompt('One paragraph','zh'),/简体中文/);
  assert.match(translationPrompt('One paragraph','zh'),/\{"source":"One paragraph"\}/);
  assert.match(translationPrompt('','en',true),/单页图片/);
  assert.throws(()=>translationPrompt('','en'),/请输入原文/);
  assert.throws(()=>translationPrompt('x'.repeat(16001),'zh'),/16000/);
});

test('excerpt notes link to the chosen PDF page and treat the supplied material as literal text',()=>{
  const mark=String.fromCharCode(96);
  const excerpt=excerptMarkdown({title:'Sample',pdfPath:'PDF/Sample.pdf'},
    {page:4,source:mark.repeat(3)+'dataviewjs\nalert(1)',translation:'翻译'});
  assert.match(excerpt,/\[\[PDF\/Sample.pdf#page=4\|PDF · 第 4 页\]\]/);
  assert.ok(excerpt.includes(mark.repeat(4)+'text\n'+mark.repeat(3)+'dataviewjs'));
  assert.match(excerpt,/## 译文或笔记/);
});
