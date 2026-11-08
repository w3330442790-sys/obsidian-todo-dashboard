'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLiteratureRecord, readingPercent, findLiteratureDuplicate, parseZoteroExport, applyJournalTagsCache, literatureBibTeX
} = require('../src/literature.cjs');

test('keeps multiple collections and deduplicated tags without changing a stable citation key', () => {
  const paper = normalizeLiteratureRecord({title:'Alpha & beta',authors:'Lee, Mei; Sun, Tao',publicationYear:2025,
    publicationTitle:'Journal A',collections:'肝损伤；综述;肝损伤',tags:['临床','Review','review'],citationKey:'lee2025alpha'});
  assert.deepEqual(paper.collections,['肝损伤','综述']);
  assert.deepEqual(paper.tags,['临床','Review']);
  assert.match(literatureBibTeX({...paper,id:'paper-12'}),/^@article\{lee2025alpha,/);
  assert.match(literatureBibTeX({...paper,id:'paper-12'}),/author = \{Lee, Mei and Sun, Tao\}/);
  assert.equal(literatureBibTeX({...paper,id:'paper-12',citationKey:''}).split('\n')[0],
    literatureBibTeX({...paper,id:'paper-12',citationKey:'',title:'Corrected title'}).split('\n')[0]);
});

test('normalizes bibliography and safely accepts vault-relative paths', () => {
  const record = normalizeLiteratureRecord({
    title: '  案例研究  ', publicationYear: '2022', doi: 'https://doi.org/10.1000/Case.2',
    url: 'https://example.test/paper', notePath: '文献\\阅读 笔记.md', pdfPath: '论文/参考 文献.PDF',
    metrics: { impactFactor: '0', jcrQuartile: 'q2', metricsYear: '2024' }
  });
  assert.equal(record.title, '案例研究');
  assert.equal(record.publicationYear, 2022);
  assert.equal(record.doi, '10.1000/case.2');
  assert.equal(record.url, 'https://example.test/paper');
  assert.equal(record.notePath, '文献/阅读 笔记.md');
  assert.equal(record.pdfPath, '论文/参考 文献.PDF');
  assert.deepEqual(record.metrics, {
    impactFactor: 0, jcrQuartile: 'Q2', casMajor: '', casMinor: '', metricsYear: 2024, metricsSource: ''
  });
  assert.equal(normalizeLiteratureRecord({ title: '无 DOI' }).doi, '');
});

test('rejects invalid metadata, unsafe URLs and paths outside the vault', () => {
  for (const fields of [
    { title: '   ' }, { publicationYear: '24' }, { doi: 'not-a-doi' },
    { url: 'javascript:alert(1)' }, { url: 'https:example.test' }, { url: 'https://user:pass@example.test' },
    { pdfPath: '../outside.pdf' }, { pdfPath: 'C:\\Users\\paper.pdf' }, { pdfPath: '/outside.pdf' },
    { notePath: 'Folder/note.exe' }, { notePath: 'Folder/../note.md' },
    { metrics: { impactFactor: '-3.2' } }, { metrics: { jcrQuartile: 'Q5' } }
  ]) assert.throws(() => normalizeLiteratureRecord({ title: 'Paper', ...fields }));
});

test('tracks page progress with an optional total and explicit reading status', () => {
  const paper = fields => normalizeLiteratureRecord({ title: 'Paper', ...fields });
  assert.equal(readingPercent(paper()), 0);
  assert.equal(readingPercent(paper({ status: 'reading', currentPage: '3', totalPages: '8' })), 38);
  assert.equal(readingPercent(paper({ status: 'reading', currentPage: '3' })), null);
  assert.equal(readingPercent(paper({ status: 'finished' })), 100);
  assert.throws(() => paper({ status: 'paused' }));
  assert.throws(() => paper({ currentPage: 4, totalPages: 3 }));
  assert.throws(() => paper({ currentPage: 1.5 }));
  assert.throws(() => paper({ totalPages: 0 }));
});

test('prioritizes Zotero item keys, then DOI, then normalized citation text', () => {
  const entries = [
    { title: 'Earlier', doi: '10.1000/a' },
    { title: 'Literature & Practice', authors: 'Li, Ming; 王小芳', publicationYear: 2023, zoteroKey: '4ABCD567' }
  ];
  assert.equal(findLiteratureDuplicate(entries, { zoteroKey: '4abcd567', doi: '10.1000/a' }), entries[1]);
  assert.equal(findLiteratureDuplicate(entries, { doi: 'https://doi.org/10.1000/A' }), entries[0]);
  assert.equal(findLiteratureDuplicate(entries, { title: '  LITERATURE ＆ Practice  ', authors: 'li,  ming; 王小芳', publicationYear: '2023' }), entries[1]);
  assert.equal(findLiteratureDuplicate(entries, { title: entries[1].title, publicationYear: 2024, authors: entries[1].authors }), undefined);
  assert.equal(findLiteratureDuplicate([{ title: 'Untitled study' }], { title: 'Untitled study' }), undefined);
  assert.equal(findLiteratureDuplicate([{ ...entries[1], doi: '10.1000/a' }], { ...entries[1], doi: '10.1000/b', zoteroKey: '' }), undefined);
});

test('parses Zotero CSV with BOM, escaped quotes, and flattened or multiline Extra', () => {
  const csv = '\ufeff"Key","Item Type","Publication Year","Author","Title","Publication Title","DOI","Url","Extra","Manual Tags","Automatic Tags"\r\n'
    + '"ABCD2345","journalArticle","2022","Lee, Mei; 王芳","A ""quoted"", title","Journal A","10.1000/a","https://example.test/a","5年影响因子: 9.2 影响因子: 4.7 JCR分区：Q1 中科院分区升级版: 医学 2区 中科院升级版小类分区: 临床医学 1区；护理学 2区 指标年份: 2024 指标来源: easyScholar","JCR: Q4",""\r\n'
    + '"EFGH6789","journalArticle","2020","","Paper B","Journal B","","","Impact Factor: 1.1\r\nJCR Quartile: Q3","",""\r\n';
  const { records, skipped } = parseZoteroExport(csv);
  assert.equal(skipped, 0);
  const [a, b] = records;
  assert.equal(a.title, 'A "quoted", title');
  assert.equal(a.authors, 'Lee, Mei; 王芳');
  assert.equal(a.publicationTitle, 'Journal A');
  assert.equal(a.publicationYear, 2022);
  assert.equal(a.zoteroKey, 'ABCD2345');
  assert.deepEqual(a.metrics, {
    impactFactor: 4.7, jcrQuartile: 'Q1', casMajor: '医学 2区', casMinor: '临床医学 1区；护理学 2区',
    metricsYear: 2024, metricsSource: 'easyScholar'
  });
  assert.equal(b.metrics.impactFactor, 1.1);
  assert.equal(b.metrics.jcrQuartile, 'Q3');
  assert.equal(b.metrics.metricsYear, null);
});

test('imports only explicit valid metrics from CSV tags and optional fields', () => {
  const { records, skipped } = parseZoteroExport('Title,Date,Extra,Manual Tags,Automatic Tags,URL,DOI,Num Pages\n'
    + 'A,Spring 2020,5年影响因子: 12; Impact Factor: N/A; SJR: 8,Q1; CCF A; CiteScore: 9,,file:///secret,invalid,15\n'
    + 'B,2021,,IF: 7.4; SCI Q2,CAS 大类: 医学 3区,,,\n'
    + ',2021,,,,,,\n', 'csv');
  assert.equal(skipped, 1);
  assert.equal(records[0].publicationYear, 2020);
  assert.equal(records[0].totalPages, 15);
  assert.equal(records[0].url, '');
  assert.equal(records[0].doi, '');
  assert.deepEqual(records[0].metrics, normalizeLiteratureRecord({ title: 'A' }).metrics);
  assert.equal(records[1].metrics.impactFactor, 7.4);
  assert.equal(records[1].metrics.jcrQuartile, 'Q2');
  assert.equal(records[1].metrics.casMajor, '医学 3区');
});

test('parses CSL JSON and Zotero API JSON without treating a citation key as an item key', () => {
  const { records, skipped } = parseZoteroExport(JSON.stringify({ items: [
    { id: 'Lee2024', type: 'article-journal', title: 'From CSL', 'container-title': 'Journal C',
      author: [{ family: 'Lee', given: 'Mei' }, { literal: 'WHO' }], issued: { 'date-parts': [[2024, 6]] } },
    { key: 'ABCD2345', data: { title: 'From Zotero', itemType: 'journalArticle', date: '2023-04-06',
      publicationTitle: 'Journal D', creators: [{ lastName: 'Wang', firstName: 'Li', creatorType: 'author' },
        { name: 'Editorial board', creatorType: 'editor' }], tags: [{ tag: 'JCR: Q4' }], sciif: '2.4' } },
    { key: 'NOTE2345', data: { itemType: 'note', parentItem: 'ABCD2345', note: '<p>中科院升级版小类分区：环境科学 3区</p>' } },
    { key: 'PDFX2345', data: { itemType: 'attachment', title: 'PDF', parentItem: 'ABCD2345' } },
    { id: 'http://zotero.org/users/123/items/WXYZ2345', title: 'CSL with Zotero item URI', note: 'JCR分区：Q1' }
  ] }), 'json');
  assert.equal(skipped, 2);
  assert.equal(records[0].zoteroKey, '');
  assert.equal(records[0].authors, 'Lee, Mei; WHO');
  assert.equal(records[0].publicationYear, 2024);
  assert.equal(records[0].publicationTitle, 'Journal C');
  assert.equal(records[1].authors, 'Wang, Li');
  assert.equal(records[1].zoteroKey, 'ABCD2345');
  assert.equal(records[1].metrics.impactFactor, 2.4);
  assert.equal(records[1].metrics.jcrQuartile, 'Q4');
  assert.equal(records[1].metrics.casMinor, '环境科学 3区');
  assert.equal(records[2].zoteroKey, 'WXYZ2345');
  assert.equal(records[2].metrics.jcrQuartile, 'Q1');
});

test('rejects malformed exports and unrelated JSON or CSV shapes', () => {
  for (const content of ['', 'Title,Extra\n"unterminated,5', 'Title,Extra\nPaper,x,y',
    'No Title,Body\nA,B', '{"wrong":true}', '{broken', 'Title,Title\nA,B']) {
    assert.throws(() => parseZoteroExport(content));
  }
  assert.deepEqual(parseZoteroExport('[]'), { records: [], skipped: 0 });
  assert.deepEqual(parseZoteroExport('Title,Extra'), { records: [], skipped: 0 });
});

test('retains labeled metrics next to empty or unrelated flattened Extra fields', () => {
  const { records: [record] } = parseZoteroExport('Title,Extra\nPaper,影响因子: JCR分区: Q2 中科院分区升级版: 工程技术 3区 中文核心期刊/北大核心: 是');
  assert.equal(record.metrics.impactFactor, null);
  assert.equal(record.metrics.jcrQuartile, 'Q2');
  assert.equal(record.metrics.casMajor, '工程技术 3区');
});

test('reads structured custom JSON metrics and keeps publication and metric years separate', () => {
  const { records: [record] } = parseZoteroExport(JSON.stringify({
    title: 'Paper', date: '2020-03-01', metrics: { impactFactor: 4.5, jcrQuartile: 'Q1', casMajor: 2, metricsYear: 2024 }
  }));
  assert.equal(record.publicationYear, 2020);
  assert.deepEqual(record.metrics, {
    impactFactor: 4.5, jcrQuartile: 'Q1', casMajor: '2', casMinor: '', metricsYear: 2024, metricsSource: ''
  });
});

test('uses the native Journal Tags cache to fill missing metrics by journal title', () => {
  const papers = [
    { title: 'A', publicationTitle: ' JOURNAL   A ', metrics: { impactFactor: 8.4, metricsYear: 2023, metricsSource: 'Export' } },
    { title: 'B', publicationTitle: 'Journal B' },
    { title: 'C', publicationTitle: 'Journal C' },
    { title: 'D', publicationTitle: 'journal d' },
    { title: 'E', publicationTitle: 'Journal E' }
  ].map(normalizeLiteratureRecord);
  const cache = '\ufeff' + JSON.stringify({
    'Journal A': { sciif: '1.3', sci: 'Q2', xr: '医学 2区', xrSmall: '医学：研究与实验 3区', _ts: 1767225600000 },
    'Journal B': { sciif: 4.2, sciUp: '地球科学 1区', sciUpSmall: '地球化学与地球物理 2区' },
    'Journal C': '', 'Journal D': { sci: 'Q1' }, 'JOURNAL D': { sci: 'Q3' }, 'Journal E': { sciBase: '地球科学 1区' }
  });
  const { records, matched, enriched } = applyJournalTagsCache(papers, cache);
  assert.equal(matched, 2);
  assert.equal(enriched, 2);
  const source = 'EasyScholar / Zotero Journal Tags';
  assert.deepEqual(records[0].metrics, {
    impactFactor: 8.4, jcrQuartile: 'Q2', casMajor: '医学 2区', casMinor: '医学：研究与实验 3区',
    metricsYear: 2023, metricsSource: 'Export', fieldSources: { jcrQuartile: source, casMajor: source, casMinor: source }
  });
  assert.equal(records[1].metrics.metricsSource, source);
  assert.equal(records[1].metrics.metricsYear, null);
  assert.equal(records[1].metrics.casMajor, '地球科学 1区');
  assert.deepEqual(normalizeLiteratureRecord(records[0]).metrics, records[0].metrics);
  assert.deepEqual(records.slice(2), papers.slice(2));
  assert.equal(papers[0].metrics.jcrQuartile, '');
  assert.throws(() => applyJournalTagsCache(papers, '{"Journal X": true}'));
});
