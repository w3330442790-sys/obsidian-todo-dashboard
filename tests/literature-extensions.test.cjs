'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {canonicalRepository,extensionEnabled,normalizeExtensions}=require('../src/literature-extensions.cjs');
const {excerptMarkdown}=require('../src/literature-reader.cjs');
const {refreshRanks}=require('../src/easyscholar.cjs');

test('built-in capabilities default to on and saved switches disable only the chosen extension',()=>{
  const settings={literatureExtensions:{enabled:{greenFrog:false,translation:true}}};
  assert.equal(extensionEnabled(settings,'greenFrog'),false);
  assert.equal(extensionEnabled(settings,'translation'),true);
  assert.equal(extensionEnabled(settings,'zoteroLocal'),true);
  assert.equal(extensionEnabled(settings,'unadapted'),false);
});

test('repository requests are canonical, deduplicated, and separate from built-in adapters',()=>{
  assert.equal(canonicalRepository('https://GitHub.com/User/Reader.git/'),'https://github.com/user/reader');
  for (const value of ['https://github.com/user/reader/releases','https://user@github.com/a/b','http://github.com/a/b',
    'https://github.com/a/b?token=secret','https://example.test/a/b']) assert.throws(()=>canonicalRepository(value),/GitHub/);
  const result=normalizeExtensions({repositories:[
    'https://github.com/User/Reader','https://github.com/user/reader.git','https://github.com/redleafnew/zotero-updateifsE'
  ]});
  assert.deepEqual(result.repositories,['https://github.com/user/reader']);
});

test('an excerpt preserves the original PDF page, translation, and personal annotation separately',()=>{
  const note=excerptMarkdown({title:'Paper',pdfPath:'PDF/Study.pdf'},
    {page:7,source:'Original',translation:'译文',comment:'自己的判断'});
  assert.match(note,/\[\[PDF\/Study.pdf#page=7\|/);
  assert.match(note,/## 原文[\s\S]*Original/);
  assert.match(note,/## 译文或笔记[\s\S]*译文/);
  assert.match(note,/## 批注[\s\S]*自己的判断/);
});

test('a scoped rank update retains old results on an empty response and ignores the rest of the library',async()=>{
  const cached={publicationName:'First',official:{sci:'Q1'},custom:[]};
  const literature=new Map([
    ['a',{id:'a',publicationTitle:'First',easyScholar:cached}],
    ['b',{id:'b',publicationTitle:'Other'}]
  ]);
  const store={literature,saveLiterature:()=>assert.fail('Empty results must not overwrite a prior hit')};
  const client={lookup:async name=>{
    assert.equal(name,'First');
    return {publicationName:name,official:{},custom:[]};
  }};
  const result=await refreshRanks(store,client,['a']);
  assert.equal(result.total,1);
  assert.equal(result.unmatched,1);
  assert.equal(result.saved,0);
  assert.equal(literature.get('a').easyScholar,cached);
});
