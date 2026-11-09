'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EasyScholar, refreshRanks} = require('../src/easyscholar.cjs');
const {normalizeLiteratureRecord, effectiveLiteratureMetrics} = require('../src/literature.cjs');

const body = (all, customRank) => ({code:200,data:{officialRank:{all,select:{ccf:'B'}},customRank}});
const custom = {
  rankInfo:[{uuid:'9223372036854775807',abbName:'CCF',oneRankText:'A'}],
  rank:['9223372036854775807&&&1']
};

test('queries the official endpoint with encoded inputs and decodes official and community ranks', async () => {
  const requests = [];
  const client = new EasyScholar(async options => {
    requests.push(options);
    return {status:200,json:body({sciif:'4.2',ssci:'Q3',sciUp:'医学2区',sciUpSmall:'临床医学 1区',futureField:'A'},custom)};
  }, () => 'test+&key', {intervalMs:0});
  const [result, duplicate] = await Promise.all([client.lookup(' 医学 & Health '),client.lookup('医学 & Health')]);
  assert.equal(requests.length,1);
  const url = new URL(requests[0].url);
  assert.equal(url.origin + url.pathname,'https://www.easyscholar.cc/open/getPublicationRank');
  assert.deepEqual(Object.fromEntries(url.searchParams),{secretKey:'test+&key',publicationName:'医学 & Health'});
  assert.equal(result,duplicate);
  assert.equal(result.official.futureField,'A');
  assert.equal(result.official.ccf,undefined);
  assert.deepEqual(result.custom,[{id:'9223372036854775807',label:'CCF',value:'A'}]);
  assert.doesNotMatch(JSON.stringify(result),/test\+&key/);

  const paper = normalizeLiteratureRecord({title:'Article',publicationTitle:'医学 & Health',metrics:{impactFactor:9,metricsYear:2023},easyScholar:result});
  assert.deepEqual(effectiveLiteratureMetrics(paper),{
    impactFactor:9,jcrQuartile:'Q3',casMajor:'医学2区',casMinor:'临床医学 1区',
    metricsYear:2023,metricsSource:'',fieldSources:{jcrQuartile:'EasyScholar',casMajor:'EasyScholar',casMinor:'EasyScholar'}
  });
  assert.equal(normalizeLiteratureRecord({...paper,publicationTitle:'Another Journal'}).easyScholar,null);
});

test('distinguishes no matches, invalid keys, rate limits, malformed replies and transport errors', async () => {
  const lookup = (response,key = 'test-key') => new EasyScholar(async () => {
    if (response instanceof Error) throw response;
    return response;
  }, () => key, {intervalMs:0}).lookup('Nature');
  const empty = await lookup({status:200,json:{code:200,data:{officialRank:{all:null,select:null},customRank:{rankInfo:[],rank:[]}}}});
  assert.deepEqual(empty.official,{});
  assert.deepEqual(empty.custom,[]);
  await assert.rejects(lookup({status:200,json:{code:40002,msg:'test-key'} }),/密钥/);
  await assert.rejects(lookup({status:429}),/频率/);
  await assert.rejects(lookup({status:200,json:{code:200,data:{officialRank:{all:[]}}}}),/格式/);
  await assert.rejects(lookup(Error('request URL included test-key')),error =>
    /网络/.test(error.message) && !error.message.includes('test-key'));
  await assert.rejects(lookup(null,''),/配置/);
});

test('batch deduplicates publication names and stops after remote errors, keeping completed records', async () => {
  const literature = new Map([
    ['a',{id:'a',publicationTitle:'Nature',metrics:{impactFactor:7}}],
    ['b',{id:'b',publicationTitle:'Nature'}],
    ['c',{id:'c',publicationTitle:'Science'}],
    ['d',{id:'d',publicationTitle:'Cell'}]
  ]);
  const store = {literature,token:(_,id)=>'token-'+id,async saveLiterature(record,token) {
    assert.equal(token,'token-'+record.id);
    literature.set(record.id,record);
  }};
  const calls = [];
  const client = new EasyScholar(async ({url}) => {
    const name = new URL(url).searchParams.get('publicationName');
    calls.push(name);
    if (name === 'Science') return {status:429};
    return {status:200,json:body({sci:'Q1'})};
  }, () => 'test-key', {intervalMs:0});
  const result = await refreshRanks(store,client,[...literature.keys()],{onlyMissing:true});
  assert.deepEqual(calls,['Nature','Science']);
  assert.equal(result.saved,2);
  assert.equal(result.total,3);
  assert.match(result.error,/频率/);
  assert.equal(literature.get('a').metrics.impactFactor,7);
  assert.equal(literature.get('b').easyScholar.official.sci,'Q1');
  assert.equal(literature.get('c').easyScholar,undefined);
});

test('skips a changed publication name while an earlier query is in flight', async () => {
  const literature = new Map([['a',{id:'a',publicationTitle:'Nature'}]]);
  const client = {async lookup() {
    literature.set('a',{id:'a',publicationTitle:'Science'});
    return {publicationName:'Nature',official:{sci:'Q1'},custom:[]};
  }};
  const store = {literature,saveLiterature:()=>assert.fail('stale result was saved')};
  const result = await refreshRanks(store,client,['a']);
  assert.equal(result.saved,0);
  assert.equal(result.skipped,1);
});

test('stopping a batch discards the in-flight result and skips the remaining requests', async () => {
  const abort = new AbortController();
  const store = {
    literature:new Map([['a',{publicationTitle:'Nature'}],['b',{publicationTitle:'Science'}]]),
    saveLiterature:() => assert.fail('cancelled result was saved')
  };
  const client = {async lookup(name) {
    assert.equal(name,'Nature');
    abort.abort();
    return {publicationName:name,official:{sci:'Q1'},custom:[]};
  }};
  const result = await refreshRanks(store,client,['a','b'],{signal:abort.signal});
  assert.equal(result.queried,0);
  assert.equal(result.saved,0);
});
