'use strict';

const origin = 'https://api.crossref.org';
const clean = value => typeof value === 'string' ? value.trim() : '';
const nameKey = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const strings = values => [...new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean))];

function normalizedIssn(value) {
  const digits = clean(value).toUpperCase().replace('-','');
  if (!/^\d{7}[\dX]$/.test(digits)) return '';
  const sum = [...digits].reduce((total,digit,index) => total + (digit === 'X' ? 10 : Number(digit)) * (8-index),0);
  return sum % 11 === 0 ? digits.slice(0,4)+'-'+digits.slice(4) : '';
}

function queryFor(input) {
  const term = clean(input).normalize('NFKC');
  if (!term) throw Error('请输入 DOI、ISSN、期刊全称或简称。');
  if (term.length > 500) throw Error('检索词过长，请输入 DOI、ISSN 或刊名。');
  const doiUrl = /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i.exec(term);
  if (doiUrl || /^(?:doi\s*:|10\.\d{4,})/i.test(term)) {
    let doi;
    try {
      doi = doiUrl ? decodeURIComponent(doiUrl[1].split(/[?#]/,1)[0]) : term.replace(/^doi\s*:\s*/i,'');
    } catch {
      throw Error('DOI 格式不合法。');
    }
    if (!/^10\.\d{4,}(?:\.\d+)*\/[^\s\x00-\x1f\x7f]+$/.test(doi)) throw Error('DOI 格式不合法。');
    return {kind:'doi',url:origin+'/works/'+encodeURIComponent(doi)};
  }
  if (/^ISSN\b/i.test(term) || /^\d{4}-?\d{3}[\dX]$/i.test(term)) {
    const issn = normalizedIssn(term.replace(/^ISSN\s*[:：]?\s*/i,''));
    if (!issn) throw Error('ISSN 格式或校验位不正确。');
    return {kind:'issn',url:origin+'/journals/'+issn};
  }
  if (/^https?:\/\//i.test(term)) throw Error('请填写刊名、DOI 或 ISSN。');
  const url = new URL('/works',origin);
  url.searchParams.set('query.container-title',term);
  url.searchParams.set('filter','type:journal-article');
  url.searchParams.set('select','container-title,short-container-title,ISSN,publisher');
  url.searchParams.set('rows','24');
  return {kind:'name',url:url.toString(),term};
}

function candidate(record,kind) {
  if (kind === 'doi' && !['journal-article','proceedings-article','journal-issue','journal-volume'].includes(record?.type)) return null;
  const name = strings(kind === 'issn' ? record?.title : record?.['container-title'])[0];
  if (!name) return null;
  return {
    name, aliases:strings(record?.['short-container-title']).filter(alias => nameKey(alias) !== nameKey(name)),
    issns:strings(record?.ISSN).map(normalizedIssn).filter(Boolean),
    publisher:clean(record?.publisher)
  };
}

function suggest(items,term) {
  const choices = [];
  for (const item of items) {
    const entry = candidate(item,'name');
    if (!entry) continue;
    const existing = choices.find(other => nameKey(other.name) === nameKey(entry.name) &&
      (!entry.issns.length || !other.issns.length || other.issns.some(issn => entry.issns.includes(issn))));
    if (existing) {
      existing.aliases = strings([...existing.aliases,...entry.aliases]);
      existing.issns = strings([...existing.issns,...entry.issns]);
    } else choices.push(entry);
  }
  return choices.sort((a,b) => matchScore(b,term)-matchScore(a,term)).slice(0,6);
}

function matchScore(item,term) {
  const key = nameKey(term);
  return nameKey(item.name) === key ? 2 : Number(item.aliases.some(alias => nameKey(alias) === key));
}

class PublicationLookup {
  constructor(request,{timeoutMs = 12000} = {}) {
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async lookup(input,{signal} = {}) {
    const {kind,url,term} = queryFor(input);
    if (signal?.aborted) return [];
    const message = await this.read(url,kind !== 'name');
    if (kind !== 'name') {
      const match = candidate(message,kind);
      return match ? [match] : [];
    }
    const items = message.items;
    if (!Array.isArray(items)) throw Error('Crossref 返回的格式无法识别。');
    const results = suggest(items,term);
    if (signal?.aborted || results.some(item => matchScore(item,term))) return results;
    const fallback = new URL(url);
    fallback.searchParams.delete('query.container-title');
    fallback.searchParams.set('query.bibliographic',term);
    const additional = await this.read(fallback.toString());
    if (!Array.isArray(additional.items)) throw Error('Crossref 返回的格式无法识别。');
    return suggest([...items,...additional.items],term);
  }

  async read(url,allowMissing = false) {
    let timer, response;
    try {
      response = await Promise.race([
        this.request({url,method:'GET',throw:false}),
        new Promise(resolve => { timer = setTimeout(() => resolve(null),this.timeoutMs); })
      ]);
    } catch {
      throw Error('无法连接 Crossref，请检查网络后重试。');
    } finally {
      clearTimeout(timer);
    }
    if (!response) throw Error('Crossref 查询超时，请稍后重试。');
    if (response.status === 404 && allowMissing) return null;
    if (response.status === 429) throw Error('Crossref 查询频率过高，请稍后重试。');
    if (response.status >= 400) throw Error('Crossref 暂时无法查询，请稍后重试。');
    let payload;
    try { payload = response.json ?? JSON.parse(response.text); }
    catch { throw Error('Crossref 返回的格式无法识别。'); }
    if (payload?.status !== 'ok' || !payload.message) throw Error('Crossref 返回的格式无法识别。');
    return payload.message;
  }
}

module.exports = {PublicationLookup};
