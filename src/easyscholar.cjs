'use strict';

const consoleUrl = 'https://www.easyscholar.cc/console/user/open';
const endpoint = 'https://www.easyscholar.cc/open/getPublicationRank';
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : Number.isFinite(value) ? String(value) : '';
const publicationKey = value => text(value).replace(/\s+/g,' ').toLowerCase();
const levels = ['oneRankText','twoRankText','threeRankText','fourRankText','fiveRankText'];
const officialLabels = {
  sciif:'影响因子', sciif5:'五年影响因子', jci:'JCI', sci:'SCIE / JCR', ssci:'SSCI / JCR',
  sciUp:'中科院大类', sciUpSmall:'中科院小类', sciUpTop:'中科院 Top', sciBase:'中科院基础版',
  sciwarn:'中科院预警', ccf:'CCF', eii:'EI', cssci:'CSSCI', pku:'北大核心', cscd:'CSCD',
  zhongguokejihexin:'中国科技核心', ahci:'AHCI', esci:'ESCI', esi:'ESI', ajg:'AJG'
};

function officialEntries(value) {
  return Object.entries(value || {}).map(([key,rank]) => [key,text(rank)])
    .filter(([key,rank]) => /^[a-z][a-z0-9_.-]*$/i.test(key) && rank);
}

function normalizeSnapshot(value, publicationTitle) {
  if (!isObject(value) || !publicationKey(publicationTitle) ||
      publicationKey(value.publicationName) !== publicationKey(publicationTitle) ||
      !isObject(value.official) || !Array.isArray(value.custom) ||
      typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))) return null;
  return {
    publicationName:text(value.publicationName), checkedAt:value.checkedAt,
    official:Object.fromEntries(officialEntries(value.official)),
    custom:value.custom.map(item => ({id:text(item?.id),label:text(item?.label),value:text(item?.value)}))
      .filter(item => item.id && item.label && item.value)
  };
}

function rankEntries(snapshot) {
  return [
    ...Object.entries(snapshot.official).map(([key,value]) => ({
      label:Object.hasOwn(officialLabels,key) ? officialLabels[key] : key, value, source:'官方'
    })),
    ...snapshot.custom.map(({id,label,value}) => ({label,value,source:'自定义 · '+id}))
  ];
}

function parseRanks(payload, publicationName) {
  const code = payload?.code;
  if (String(code) !== '200') {
    if (['40002','40005'].includes(String(code))) throw Error('EasyScholar 密钥无效，请检查开放接口设置。');
    if (!/^\d{3,6}$/.test(String(code))) throw Error('EasyScholar 返回的格式无法识别。');
    throw Error(`EasyScholar 查询被拒绝（代码 ${code}），请检查账号权限和配额。`);
  }
  const data = payload.data;
  if (!isObject(data) || !Object.hasOwn(data,'officialRank') && !Object.hasOwn(data,'customRank')) {
    throw Error('EasyScholar 返回的格式无法识别。');
  }
  const official = data.officialRank?.all ?? data.officialRank?.select;
  const custom = data.customRank;
  if (data.officialRank != null && !isObject(data.officialRank) ||
      official != null && !isObject(official) ||
      custom != null && (!isObject(custom) ||
        custom.rank != null && !Array.isArray(custom.rank) ||
        custom.rankInfo != null && !Array.isArray(custom.rankInfo))) {
    throw Error('EasyScholar 返回的格式无法识别。');
  }
  const definitions = new Map((custom?.rankInfo || []).map(item => [text(item?.uuid),item]));
  const community = new Map();
  for (const entry of custom?.rank || []) {
    const match = /^([^&]+)&&&([1-5])$/.exec(text(entry));
    if (!match) continue;
    const [,id,level] = match;
    const dataset = definitions.get(id);
    const label = text(dataset?.abbName) || text(dataset?.name) || id;
    const value = text(dataset?.[levels[Number(level)-1]]) || `等级 ${level}`;
    community.set(entry,{id,label,value});
  }
  return {
    publicationName, checkedAt:new Date().toISOString(),
    official:Object.fromEntries(officialEntries(official)), custom:[...community.values()]
  };
}

class EasyScholar {
  constructor(request, getSecret, {intervalMs = 550, timeoutMs = 20000} = {}) {
    this.request = request;
    this.getSecret = getSecret;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.inFlight = new Map();
    this.queue = Promise.resolve();
    this.nextRequestAt = 0;
  }

  async lookup(publicationName) {
    const name = text(publicationName);
    if (!name) throw Error('请输入期刊或会议名称。');
    const secret = text(this.getSecret());
    if (!secret) throw Error('请先配置 EasyScholar Secret Key。');
    const key = JSON.stringify([secret,publicationKey(name)]);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const job = this.queue.then(async () => {
      const delay = this.nextRequestAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve,delay));
      if (text(this.getSecret()) !== secret) throw Error('EasyScholar 密钥已变更，请重新查询。');
      this.nextRequestAt = Date.now() + this.intervalMs;
      return this.fetchRanks(name,secret);
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key,job);
    this.queue = job.catch(() => {});
    return job;
  }

  async fetchRanks(name,secret) {
    const url = new URL(endpoint);
    url.searchParams.set('secretKey',secret);
    url.searchParams.set('publicationName',name);
    let timer, response;
    const timeout = Symbol('timeout');
    try {
      response = await Promise.race([
        this.request({url:url.toString(),method:'GET',throw:false}),
        new Promise(resolve => { timer = setTimeout(() => resolve(timeout),this.timeoutMs); })
      ]);
    } catch {
      throw Error('无法连接 EasyScholar，请检查网络后重试。');
    } finally {
      clearTimeout(timer);
    }
    if (response === timeout) throw Error('EasyScholar 查询超时，请稍后重试。');
    if (response?.status === 429) throw Error('EasyScholar 查询频率过高，请稍后重试。');
    if ([401,403].includes(response?.status)) throw Error('EasyScholar 拒绝访问，请检查密钥和账号权限。');
    if (!response || response.status >= 400) throw Error('EasyScholar 服务暂时不可用，请稍后重试。');
    let payload;
    try {
      payload = response.json ?? JSON.parse(response.text);
    } catch {
      throw Error('EasyScholar 返回的格式无法识别。');
    }
    return parseRanks(payload,name);
  }
}

async function savePaperRank(store,client,original,name,{signal} = {}) {
  function currentPaper() {
    const current = store.literature.get(original.id);
    if (!current || current.deleted || current.publicationTitle !== original.publicationTitle || current.doi !== original.doi) {
      throw Error('文献来源已变更，请从文献卡片重新打开查询。');
    }
    return current;
  }
  currentPaper();
  const publicationTitle = text(name);
  const snapshot = {...await client.lookup(publicationTitle),publicationName:publicationTitle};
  if (signal?.aborted) return {snapshot,saved:false};
  const current = currentPaper();
  if (!rankEntries(snapshot).length && (current.easyScholar && rankEntries(current.easyScholar).length ||
      publicationKey(snapshot.publicationName) !== publicationKey(current.publicationTitle))) return {snapshot,saved:false};
  await store.saveLiterature({...current,publicationTitle,easyScholar:snapshot},store.token('literature',current.id));
  return {snapshot,saved:true};
}

async function refreshRanks(store,client,ids,{onlyMissing = false,signal,onProgress} = {}) {
  const groups = new Map();
  const eligible = paper => paper && !paper.deleted && publicationKey(paper.publicationTitle) &&
    (!onlyMissing || !paper.easyScholar);
  for (const id of new Set(ids)) {
    const paper = store.literature.get(id);
    if (!eligible(paper)) continue;
    const key = publicationKey(paper.publicationTitle);
    if (!groups.has(key)) groups.set(key,{name:paper.publicationTitle,ids:[]});
    groups.get(key).ids.push(id);
  }
  const result = {total:groups.size,queried:0,saved:0,unmatched:0,skipped:0,conflicts:0,error:''};
  for (const [key,group] of groups) {
    if (signal?.aborted) break;
    let snapshot;
    try {
      snapshot = await client.lookup(group.name);
    } catch (error) {
      result.error = error.message;
      break;
    }
    if (signal?.aborted) break;
    result.queried++;
    if (!rankEntries(snapshot).length) result.unmatched++;
    for (const id of group.ids) {
      if (signal?.aborted) break;
      const current = store.literature.get(id);
      if (!eligible(current) || publicationKey(current.publicationTitle) !== key) {
        result.skipped++;
        continue;
      }
      try {
        await store.saveLiterature({...current,easyScholar:snapshot},store.token('literature',id));
        result.saved++;
      } catch {
        result.conflicts++;
      }
    }
    onProgress?.({...result});
  }
  return result;
}

module.exports = {consoleUrl, EasyScholar, normalizeSnapshot, rankEntries, refreshRanks, savePaperRank};
