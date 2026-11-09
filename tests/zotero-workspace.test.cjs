'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeLiteratureRecord,parseZoteroExport,missingBibliography} = require('../src/literature.cjs');
const {libraryRows} = require('../src/literature-library.cjs');
const {ZoteroLocal,prepareLiteratureImport} = require('../src/zotero-local.cjs');

test('Zotero import keeps date precision and right-pane metadata for CSV, API and CSL', () => {
  const csv = 'Key,Item Type,Title,Date,Publication Year,Volume,Issue,Pages,Journal Abbr,ISSN,Abstract Note\n'
    + 'ABCD2345,journalArticle,Paper,2024-03,2024,80,3,431-442,J. Hepatol.,0168-8278,An abstract';
  const [paper] = parseZoteroExport(csv).records;
  assert.equal(paper.publicationDate,'2024-03');
  assert.equal(paper.publicationYear,2024);
  assert.deepEqual(paper.bibliography,{
    itemType:'journalArticle',volume:'80',issue:'3',pages:'431-442',
    journalAbbreviation:'J. Hepatol.',issn:'0168-8278',abstractNote:'An abstract'
  });
  const [api,csl] = parseZoteroExport(JSON.stringify([
    {meta:{parsedDate:'2024-02-29'},data:{itemType:'bookSection',title:'Chapter',date:'February 29, 2024',bookTitle:'Collected works',
      publisher:'Example Press',place:'Wuhan',abstractNote:'Overview',ISBN:'123',language:'zh-CN'}},
    {type:'article-journal',title:'Another',issued:{'date-parts':[[2026,1,5]]},page:'11–15',
      'container-title-short':'Sci. Rep.',ISSN:'2045-2322'}
  ])).records;
  assert.equal(api.publicationDate,'2024-02-29');
  assert.equal(api.publicationTitle,'Collected works');
  assert.equal(api.bibliography.publisher,'Example Press');
  assert.equal(csl.publicationDate,'2026-01-05');
  assert.equal(csl.bibliography.journalAbbreviation,'Sci. Rep.');
  assert.equal(csl.bibliography.pages,'11–15');
  const partial = parseZoteroExport(JSON.stringify([{meta:{parsedDate:'2024-03-00'},
    data:{itemType:'journalArticle',title:'Month only',date:'March 2024'}}])).records[0];
  assert.equal(partial.publicationDate,'2024-03');
  const [legal] = parseZoteroExport(JSON.stringify([{data:{itemType:'case',caseName:'Example v. Sample'}}])).records;
  assert.equal(legal.title,'Example v. Sample');
});

test('invalid dates are rejected and legacy year-only items retain their original precision', () => {
  assert.equal(normalizeLiteratureRecord({title:'Legacy',publicationYear:2020}).publicationYear,2020);
  assert.equal(normalizeLiteratureRecord({title:'Date',publicationDate:'2024/2/9'}).publicationDate,'2024-02-09');
  assert.throws(() => normalizeLiteratureRecord({title:'Date',publicationDate:'2023-02-29'}),/日期/);
  assert.throws(() => normalizeLiteratureRecord({title:'Date',rating:6}),/评分/);
  assert.equal(normalizeLiteratureRecord({title:'Notes',rating:'4',memo:' read later '}).memo,'read later');
});

test('reimport only fills missing fields for a strong identity and preserves local edits', () => {
  const original = normalizeLiteratureRecord({title:'Local title',doi:'10.1000/a',publicationYear:2024,
    bibliography:{volume:'Local'},rating:5,memo:'Local note',pdfPath:'papers/a.pdf'});
  const incoming = normalizeLiteratureRecord({title:'Remote title',doi:'10.1000/a',publicationDate:'2024-03',
    publicationTitle:'Journal A',bibliography:{volume:'Other',issue:'3',pages:'1–5'}});
  assert.deepEqual(missingBibliography(original,incoming),{
    publicationDate:'2024-03',publicationTitle:'Journal A',bibliography:{volume:'Local',issue:'3',pages:'1–5'}
  });
  assert.equal(missingBibliography(original,{...incoming,doi:'10.1000/b'}),null);
  assert.equal(missingBibliography({...original,publicationYear:2023},
    {...incoming,publicationTitle:'',bibliography:{volume:'Other'}}),null);
});

test('library searches across fields and tags, excludes deleted rows and sorts full dates', () => {
  const paper = data => ({...normalizeLiteratureRecord(data),id:data.id,deleted:data.deleted});
  const records = [
    paper({id:'a',title:'Hepatic trial',authors:'Ding, Li',publicationDate:'2024-04',collections:['Clinical'],tags:['Review'],bibliography:{abstractNote:'Immunotherapy'},metrics:{jcrQuartile:'Q1'}}),
    paper({id:'b',title:'Case series',authors:'Wang',publicationDate:'2024-11',collections:['Clinical'],tags:['Review'],bibliography:{abstractNote:'Immunotherapy'},metrics:{jcrQuartile:'Q1'}}),
    paper({id:'c',title:'Other',publicationDate:'2025',collections:['Lab'],metrics:{jcrQuartile:'Q2'}}),
    paper({id:'d',title:'Removed',publicationDate:'2026',collections:['Clinical'],deleted:true})
  ];
  const rows = libraryRows(records,{query:'immunotherapy q1',collection:'Clinical',tag:'Review',sort:'date',descending:true});
  assert.deepEqual(rows.map(({paper})=>paper.id),['b','a']);
  assert.deepEqual(libraryRows(records,{query:'immunotherapy',scope:'title'}),[]);
  assert.deepEqual(libraryRows(records,{sort:'date',descending:false}).map(({paper})=>paper.id),['a','b','c']);
});

test('local Zotero reads personal items and collections in pages, without exporting or writing Zotero',async () => {
  const calls = [];
  const items = [
    {key:'ABCD2345',data:{itemType:'journalArticle',title:'One',collections:['CHILD234'],date:'2024-03'}},
    {key:'WXYZ2345',data:{itemType:'journalArticle',title:'Two',collections:['PAREN234']}}
  ];
  const collections = [
    {key:'PAREN234',data:{name:'Hepatology',parentCollection:false}},
    {key:'CHILD234',data:{name:'Trials',parentCollection:'PAREN234'}}
  ];
  const client = new ZoteroLocal(async request => {
    const url = new URL(request.url);
    calls.push(url);
    assert.equal(url.origin,'http://localhost:23119');
    assert.equal(request.method,'GET');
    assert.equal(request.headers['Zotero-API-Version'],'3');
    assert.equal(request.headers['Zotero-Allowed-Request'],'true');
    const start = Number(url.searchParams.get('start'));
    const records = url.pathname.endsWith('/collections') ? collections : items;
    return {status:200,json:records.slice(start,start+1),headers:{'total-results':'2'}};
  },{pageSize:1});
  const result = await client.read();
  assert.equal(calls.length,4);
  assert.deepEqual(result.records.map(record=>[record.title,record.collections]),[
    ['One',['Hepatology / Trials']],['Two',['Hepatology']]
  ]);
});

test('repeat Zotero import prepares only new or incomplete items and respects deleted records',() => {
  const imported = normalizeLiteratureRecord({title:'Imported',zoteroKey:'ABCD2345',publicationDate:'2024-03'});
  const local = {...normalizeLiteratureRecord({title:'Local title',zoteroKey:'ABCD2345',publicationYear:2024}),id:'existing'};
  const removed = {...normalizeLiteratureRecord({title:'Removed',zoteroKey:'EFGH6789'}),id:'deleted',deleted:true};
  const result = prepareLiteratureImport([imported,imported,removed],[local,removed],id=>id+'-token');
  assert.equal(result.added,0);
  assert.equal(result.enriched,1);
  assert.equal(result.repeated,2);
  assert.deepEqual(result.changes,[{original:local,patch:{publicationDate:'2024-03'},token:'existing-token'}]);
  assert.deepEqual(prepareLiteratureImport([imported],[{...local,publicationDate:'2024-03'}],()=> '').changes,[]);
});
