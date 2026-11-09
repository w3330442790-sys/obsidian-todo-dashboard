'use strict';

const {parseZoteroExport,findLiteratureDuplicate,missingBibliography} = require('./literature.cjs');
const base = 'http://localhost:23119/api/users/0/';

function collectionPaths(collections) {
  const entries = new Map(collections.filter(row => typeof row?.data?.name === 'string')
    .map(row => [row.key || row.data.key,row.data]));
  function pathFor(key) {
    const names = [];
    const seen = new Set();
    while (key && entries.has(key) && !seen.has(key)) {
      seen.add(key);
      const entry = entries.get(key);
      names.unshift(entry.name);
      key = entry.parentCollection;
    }
    return names.join(' / ');
  }
  return new Map([...entries.keys()].map(key=>[key,pathFor(key)]));
}

class ZoteroLocal {
  constructor(request,{pageSize = 100,timeoutMs = 15000} = {}) {
    this.request = request;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
  }

  async read() {
    const items = await this.readPages('items/top');
    const collections = collectionPaths(await this.readPages('collections'));
    const rows = items.map(row => {
      const data = row.data;
      const keys = Array.isArray(data.collections) ? data.collections : [];
      return {...row,data:{...data,collectionNames:keys.map(key=>collections.get(key)).filter(Boolean)}};
    });
    return parseZoteroExport(JSON.stringify(rows),'json');
  }

  async readPages(path) {
    const rows = [];
    const keys = new Set();
    let total;
    for (;;) {
      const url = new URL(path,base);
      url.searchParams.set('start',String(rows.length));
      url.searchParams.set('limit',String(this.pageSize));
      url.searchParams.set('format','json');
      const {page,count} = await this.readPage(url);
      if (total != null && count != null && total !== count) throw Error('Zotero 文献库在读取时发生变化，请重新刷新。');
      total ??= count;
      for (const row of page) {
        const key = row?.key || row?.data?.key;
        if (!key || !row?.data || keys.has(key)) throw Error('Zotero 返回了重复或无法识别的记录，请重新刷新。');
        keys.add(key);
        rows.push(row);
      }
      if (total == null ? page.length < this.pageSize : rows.length === total) return rows;
      if (!page.length || total != null && rows.length > total) throw Error('Zotero 返回的分页结果不完整，请重新刷新。');
    }
  }

  async readPage(url) {
    let timer, response;
    try {
      response = await Promise.race([
        this.request({url:url.toString(),method:'GET',throw:false,
          headers:{'Zotero-API-Version':'3','Zotero-Allowed-Request':'true'}}),
        new Promise(resolve => { timer = setTimeout(()=>resolve(null),this.timeoutMs); })
      ]);
    } catch {
      throw Error('连接不到本机 Zotero，请打开 Zotero 并允许本机应用通信。');
    } finally {
      clearTimeout(timer);
    }
    if (!response) throw Error('本机 Zotero 响应超时，请检查 Zotero 是否打开。');
    if (response.status === 403) throw Error('请在 Zotero 设置 → 高级中启用「允许本机其他应用与 Zotero 通信」。');
    if (response.status !== 200) throw Error(`本机 Zotero 接口暂不可用（HTTP ${response.status}）。`);
    let page;
    try { page = response.json ?? JSON.parse(response.text); }
    catch { throw Error('无法识别本机 Zotero 返回的数据。'); }
    if (!Array.isArray(page)) throw Error('无法识别本机 Zotero 返回的数据。');
    const total = Object.entries(response.headers || {}).find(([key])=>key.toLowerCase()==='total-results')?.[1];
    const count = /^\d+$/.test(String(total)) ? Number(total) : undefined;
    return {page,count};
  }
}

function prepareLiteratureImport(records,current,tokenFor) {
  const known = [...current];
  const changes = [];
  const updated = new Set();
  let added = 0;
  for (const record of records) {
    const original = findLiteratureDuplicate(known,record);
    if (original) {
      const patch = original.id && !original.deleted && !updated.has(original.id) && missingBibliography(original,record);
      if (patch) {
        changes.push({original,patch,token:tokenFor(original.id)});
        updated.add(original.id);
      }
      continue;
    }
    known.push(record);
    changes.push({patch:record});
    added++;
  }
  return {changes,added,enriched:updated.size,repeated:records.length-changes.length};
}

module.exports = {ZoteroLocal,prepareLiteratureImport};
