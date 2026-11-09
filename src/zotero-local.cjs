'use strict';

const {parseZoteroExport,findLiteratureDuplicate,missingBibliography} = require('./literature.cjs');
const base = 'http://localhost:23119/api/users/0/';
const keyPattern = /^[A-Z0-9]{8}$/;
const text = value => typeof value === 'string' ? value.trim() : '';
const titleKey = value => text(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const doiKey = value => text(value).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').toLowerCase();

function pdfDescriptor(row,parentKey) {
  const data = row?.data;
  const key = row?.key || data?.key;
  const filename = text(data?.filename);
  const type = text(data?.contentType).toLowerCase().split(';',1)[0];
  if (!keyPattern.test(key || '') || data?.itemType !== 'attachment' || data.parentItem !== parentKey ||
      data.deleted || !['imported_file','imported_url','linked_file'].includes(data.linkMode) ||
      (type && type !== 'application/pdf') || (!type && !/\.pdf$/i.test(filename))) return null;
  return {key,title:text(data.title) || filename || 'PDF 附件',filename};
}

function jsonBody(response) {
  try { return response.json ?? JSON.parse(response.text); }
  catch { throw Error('无法识别本机 Zotero 返回的数据。'); }
}

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

  async verifyPaper(paper) {
    const key = paper?.zoteroKey;
    if (!keyPattern.test(key || '')) throw Error('此文献没有有效的 Zotero 条目标识。');
    const row = jsonBody(await this.get(new URL('items/'+key,base)));
    const data = row?.data;
    const localDoi = doiKey(paper.doi);
    const remoteDoi = doiKey(data?.DOI);
    const remoteTitle = titleKey(data?.title || data?.caseName || data?.nameOfAct || data?.subject);
    const same = localDoi && remoteDoi ? localDoi === remoteDoi : Boolean(remoteTitle && remoteTitle === titleKey(paper.title));
    if (!data || (row.key || data.key) !== key || data.parentItem || data.deleted ||
        ['attachment','annotation','note'].includes(data.itemType) || !same) {
      throw Error('本机 Zotero 条目与当前文献不匹配，请核对库与书目信息。');
    }
    return key;
  }

  async listPdfs(paper) {
    const key = await this.verifyPaper(paper);
    const children = await this.readPages('items/'+key+'/children');
    return children.map(row=>pdfDescriptor(row,key)).filter(Boolean);
  }

  async pdfUrl(paper,attachmentKey) {
    if (!keyPattern.test(attachmentKey || '')) throw Error('PDF 附件标识不合法。');
    const key = await this.verifyPaper(paper);
    const path = 'items/'+attachmentKey;
    const row = jsonBody(await this.get(new URL(path,base)));
    if (pdfDescriptor(row,key)?.key !== attachmentKey) throw Error('Zotero 附件已变更，请重新选择。');
    const response = await this.get(new URL(path+'/file/view/url',base));
    return text(response.text);
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

  async get(url) {
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
    if (response.status === 404) throw Error('本机 Zotero 中未找到该条目或附件。');
    if (response.status !== 200) throw Error(`本机 Zotero 接口暂不可用（HTTP ${response.status}）。`);
    return response;
  }

  async readPage(url) {
    const response = await this.get(url);
    const page = jsonBody(response);
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
