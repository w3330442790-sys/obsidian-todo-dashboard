'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PublicationLookup} = require('../src/publication-lookup.cjs');
const {savePaperRank} = require('../src/easyscholar.cjs');
const {showEasyScholar} = require('../src/literature-view.cjs');

test('DOI and ISSN use public Crossref endpoints and return publication metadata', async () => {
  const requests = [];
  const client = new PublicationLookup(async ({url}) => {
    const parsed = new URL(url);
    requests.push(parsed);
    assert.equal(parsed.origin,'https://api.crossref.org');
    assert.equal(parsed.searchParams.has('secretKey'),false);
    const message = parsed.pathname.startsWith('/works/') ?
      {type:'journal-article','container-title':['Journal of Tests'],'short-container-title':['J Tests'],ISSN:['0028-0836']} :
      {title:'Journal of Tests',ISSN:['0028-0836'],publisher:'Example Press'};
    return {status:200,json:{status:'ok',message}};
  });
  const [doi] = await client.lookup('https://doi.org/10.1000/a%26b');
  const [issn] = await client.lookup('ISSN 00280836');
  assert.equal(decodeURIComponent(requests[0].pathname),'/works/10.1000/a&b');
  assert.equal(requests[1].pathname,'/journals/0028-0836');
  assert.equal(doi.name,'Journal of Tests');
  assert.deepEqual(doi.aliases,['J Tests']);
  assert.equal(issn.publisher,'Example Press');
  await assert.rejects(client.lookup('0028-0837'),/ISSN/);
  assert.equal(requests.length,2);
});

test('title search prioritizes exact abbreviations and keeps distinct journals for user selection', async () => {
  const client = new PublicationLookup(async ({url}) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('query.container-title'),'J. Test');
    return {status:200,json:{status:'ok',message:{items:[
      {'container-title':['Other Test'],'short-container-title':['Other T'],ISSN:['1476-4687']},
      {'container-title':['Journal of Tests'],'short-container-title':['J Test'],ISSN:['0028-0836']},
      {'container-title':['Journal of Tests'],'short-container-title':['J Test'],ISSN:['0028-0836']},
      {'container-title':['Journal of Tests'],'short-container-title':['J Test'],ISSN:['1234-5679']}
    ]}}};
  });
  const results = await client.lookup('J. Test');
  assert.deepEqual(results.map(x=>x.issns[0]),['0028-0836','1234-5679','1476-4687']);
});

test('bibliographic search can find an abbreviation missed by the container-title query', async () => {
  const terms = [];
  const client = new PublicationLookup(async ({url}) => {
    const params = new URL(url).searchParams;
    terms.push(params.get('query.container-title') || params.get('query.bibliographic'));
    const entry = params.has('query.container-title') ?
      {'container-title':['Med'],ISSN:['2666-6340']} :
      {'container-title':['New England Journal of Medicine'],'short-container-title':['N Engl J Med'],ISSN:['0028-4793']};
    return {status:200,json:{status:'ok',message:{items:[entry]}}};
  });
  const results = await client.lookup('N Engl J Med');
  assert.deepEqual(terms,['N Engl J Med','N Engl J Med']);
  assert.equal(results[0].name,'New England Journal of Medicine');
});

test('unknown identifiers return no result and repository names from preprint DOI are excluded', async () => {
  const missing = new PublicationLookup(async () => ({status:404}));
  assert.deepEqual(await missing.lookup('10.1000/missing'),[]);
  const preprint = new PublicationLookup(async () => ({
    status:200,json:{status:'ok',message:{type:'posted-content','container-title':['Preprint server']}}
  }));
  assert.deepEqual(await preprint.lookup('10.1000/preprint'),[]);
});

test('saving a confirmed name and rank is atomic and preserves edits to unrelated fields', async () => {
  const original = {id:'p',publicationTitle:'J Test',doi:'10.1000/a',currentPage:1,metrics:{impactFactor:5}};
  const records = new Map([[original.id,original]]);
  const store = {literature:records,token:()=> 'latest',async saveLiterature(paper,token) {
    assert.equal(token,'latest');
    records.set(paper.id,paper);
  }};
  const client = {async lookup(name) {
    records.set(original.id,{...original,currentPage:4});
    return {publicationName:name.toLowerCase(),official:{sci:'Q2'},custom:[]};
  }};
  const result = await savePaperRank(store,client,original,'Journal of Tests');
  assert.equal(result.saved,true);
  assert.equal(records.get('p').publicationTitle,'Journal of Tests');
  assert.equal(records.get('p').easyScholar.publicationName,'Journal of Tests');
  assert.equal(records.get('p').easyScholar.official.sci,'Q2');
  assert.equal(records.get('p').currentPage,4);
  assert.equal(records.get('p').metrics.impactFactor,5);
  await assert.rejects(savePaperRank(store,client,original,'Other journal'),/已变更/);
});

test('a different name with no ranks leaves the saved publication intact', async () => {
  const original = {id:'p',publicationTitle:'Original Journal'};
  const store = {literature:new Map([['p',original]]),saveLiterature:()=>assert.fail('unmatched rename saved')};
  const client = {lookup:async name => ({publicationName:name,official:{},custom:[]})};
  const result = await savePaperRank(store,client,original,'Other Journal');
  assert.equal(result.saved,false);
});

test('the modal resets a selected Crossref candidate when its search term changes', async () => {
  const controls = new Map();
  function el(parent,tag,cls,text) {
    const node = {children:[],textContent:text,setAttribute(){},
      addEventListener(type,fn){this[type] = fn;},replaceChildren(){this.children.length = 0;}};
    parent.children.push(node);
    return node;
  }
  const ui = {
    el,
    button(parent,label,action) {
      const node = el(parent,'button','',label);
      controls.set(label,{node,action});
      return node;
    },
    formField(parent,label,type,value) {
      const node = el(parent,'input',type,label);
      node.value = value ?? '';
      controls.set(label,{node});
      return node;
    }
  };
  const original = {id:'p',publicationTitle:'Original Journal'};
  const store = {literature:new Map([['p',original]]),token:()=> 'token',
    async saveLiterature(record){this.literature.set(record.id,record);}};
  const plugin = {
    app:{},store,refresh(){},easyScholarKey:()=> 'fixture',
    publicationLookup:{lookup:async () => [{name:'Candidate Journal',issns:[],aliases:[]}]},
    easyScholar:{lookup:async name => {
      assert.equal(name,'Original Journal');
      return {publicationName:name,checkedAt:'2026-11-09T00:00:00.000Z',official:{sci:'Q1'},custom:[]};
    }}
  };
  showEasyScholar(plugin,{children:[]},{close(){}},'p',ui);
  await controls.get('在 Crossref 查刊名').action();
  controls.get('Candidate Journal').action();
  const name = controls.get('期刊或会议名称').node;
  assert.equal(name.value,'Candidate Journal');
  const term = controls.get('DOI、ISSN、刊名或简称').node;
  term.value = 'Another query';
  term.input();
  assert.equal(name.value,'Original Journal');
  await controls.get('查询并保存').action();
  assert.equal(store.literature.get('p').easyScholar.official.sci,'Q1');
});
