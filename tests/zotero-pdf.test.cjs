'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {ZoteroLocal} = require('../src/zotero-local.cjs');
const {readLocalPdf,importZoteroPdf} = require('../src/literature-pdf.cjs');
const {pdfFixture} = require('./fixtures/pdf-fixture.cjs');

const paper = {id:'p',title:'Study',doi:'10.1000/study',zoteroKey:'ABCD2345',currentPage:4,status:'reading'};
const parent = {key:paper.zoteroKey,data:{itemType:'journalArticle',title:'Original title',DOI:'10.1000/STUDY'}};
const child = (key,fields = {}) => ({key,data:{
  itemType:'attachment',parentItem:paper.zoteroKey,linkMode:'imported_file',contentType:'application/pdf',
  title:'Study PDF',filename:'Study.pdf',...fields
}});

test('lists only PDF files belonging to the matching Zotero item and checks ownership before resolving a path',async () => {
  const good = child('GOOD2345');
  const calls = [];
  const zotero = new ZoteroLocal(async ({url,method}) => {
    const endpoint = new URL(url);
    calls.push(endpoint.pathname);
    assert.equal(endpoint.origin,'http://localhost:23119');
    assert.equal(method,'GET');
    if (endpoint.pathname.endsWith('/children')) return {status:200,json:[
      good,child('LINK2345',{linkMode:'linked_url'}),child('OTHR2345',{parentItem:'OTHER456'}),
      child('HTML2345',{contentType:'text/html'}),child('TRSH2345',{deleted:1})
    ]};
    if (endpoint.pathname.endsWith('/file/view/url')) return {status:200,text:'file:///library/Study.pdf'};
    return {status:200,json:endpoint.pathname.endsWith('/GOOD2345') ? good : parent};
  });
  assert.deepEqual(await zotero.listPdfs(paper),[{key:'GOOD2345',title:'Study PDF',filename:'Study.pdf'}]);
  assert.equal(await zotero.pdfUrl(paper,'GOOD2345'),'file:///library/Study.pdf');
  assert.ok(calls.includes('/api/users/0/items/GOOD2345/file/view/url'));
  await assert.rejects(zotero.listPdfs({...paper,doi:'10.1000/different'}),/不匹配/);
  await assert.rejects(zotero.pdfUrl(paper,'../GOOD2345'),/附件标识/);
});

test('opens only a local PDF URL and limits the size before reading bytes',async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'todo-zotero-pdf-'));
  const bytes = pdfFixture('Local Zotero fixture');
  const file = path.join(dir,'附录 #1.pdf');
  const big = path.join(dir,'Large.pdf');
  try {
    await fs.writeFile(file,bytes);
    await fs.writeFile(big,'');
    await fs.truncate(big,50*1024*1024+1);
    const upload = await readLocalPdf(pathToFileURL(file).href);
    assert.equal(upload.name,'附录 #1.pdf');
    assert.deepEqual(Buffer.from(await upload.arrayBuffer()),bytes);
    await assert.rejects(readLocalPdf('file://example.test/shared/sample.pdf'),/本机/);
    await assert.rejects(readLocalPdf('https://example.test/remote.pdf'),/本机/);
    await assert.rejects(readLocalPdf(pathToFileURL(big).href),/50 MB/);
  } finally {
    await Promise.all([fs.unlink(file).catch(()=>{}),fs.unlink(big).catch(()=>{})]);
    await fs.rmdir(dir);
  }
});

test('Zotero PDF import preserves a concurrent progress edit and skips writes after removal',async () => {
  const bytes = pdfFixture('Synthetic attachment');
  const file = {name:'Study.pdf',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
  const literature = new Map([[paper.id,paper]]);
  const files = new Map();
  const plugin = {
    zoteroLocal:{pdfUrl:async()=> 'file:///library/Study.pdf'},
    app:{vault:{getFiles:()=>[...files.values()],getAbstractFileByPath:key=>files.get(key),
      createBinary:async (key,data)=>files.set(key,{path:key,extension:'pdf',data})}},
    store:{root:'Todo工作台',literature,token:()=> 'latest',ensureFolder:async()=>{},
      saveLiterature:async (record,token)=>{assert.equal(token,'latest');literature.set(record.id,record);return record;}}
  };
  const imported = await importZoteroPdf(plugin,paper,'GOOD2345',{readFile:async()=>{
    literature.set(paper.id,{...paper,currentPage:8,memo:'local'});
    return file;
  }});
  assert.equal(imported.paper.currentPage,8);
  assert.equal(imported.paper.memo,'local');
  assert.equal(files.size,1);
  assert.match(imported.paper.pdfPath,/\/_zotero-items\/p\//);
  const sibling = {...paper,id:'other'};
  literature.set(sibling.id,sibling);
  const second = await importZoteroPdf(plugin,sibling,'GOOD2345',{readFile:async()=>file});
  assert.notEqual(second.paper.pdfPath,imported.paper.pdfPath);
  assert.equal(files.size,2);
  literature.set(paper.id,paper);
  await assert.rejects(importZoteroPdf(plugin,paper,'GOOD2345',{readFile:async()=>{
    literature.set(paper.id,{...paper,deleted:true});
    return file;
  }}),/已移出/);
  assert.equal(files.size,2);
});

test('cancelling a Zotero copy removes only the newly created unlinked file',async()=>{
  const bytes = pdfFixture('Cancel after the copy');
  const controller = new AbortController();
  const files = new Map();
  const existing={path:'Todo工作台/literature-pdfs/Existing.pdf',data:bytes,extension:'pdf'};
  files.set(existing.path,existing);
  const vault={
    getFiles:()=>[...files.values()],getAbstractFileByPath:key=>files.get(key),readBinary:async file=>file.data,
    createBinary:async (key,data)=>{
      const created={path:key,extension:'pdf',data};
      files.set(key,created);
      controller.abort();
      return created;
    },
    delete:async file=>files.delete(file.path)
  };
  const plugin={
    zoteroLocal:{pdfUrl:async()=> 'file:///library/Study.pdf'},app:{vault},
    store:{root:'Todo工作台',literature:new Map([[paper.id,paper]]),token:()=> 'latest',ensureFolder:async()=>{},
      saveLiterature:()=>assert.fail('Cancelled copy must not attach a PDF')}
  };
  const readFile=async()=>({name:'Study.pdf',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
  await assert.rejects(importZoteroPdf(plugin,paper,'GOOD2345',{signal:controller.signal,readFile}),{name:'AbortError'});
  assert.deepEqual([...files.values()],[existing]);
});
