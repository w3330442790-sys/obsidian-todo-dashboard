'use strict';

const statuses = new Set(['unread', 'reading', 'finished']);
const metricFields = ['impactFactor', 'jcrQuartile', 'casMajor', 'casMinor'];
const cacheSource = 'EasyScholar / Zotero Journal Tags';

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const trimmed = value => typeof value === 'string' ? value.trim() : '';
const scalar = value => typeof value === 'number' ? String(value) : trimmed(value);
const folded = value => trimmed(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const headerKey = value => folded(value).replace(/[\s_-]+/g, '');
const missing = value => value == null || typeof value === 'string' && !value.trim();

function labels(value) {
  const values = Array.isArray(value) ? value : trimmed(value).split(/[;；、，\n]/);
  const seen = new Set();
  return values.map(trimmed).filter(label => {
    const key = folded(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function citationKey(value) {
  const key = trimmed(value);
  if (key && !/^[a-z0-9][a-z0-9_.:-]*$/i.test(key)) throw Error('引用键只支持英文字母、数字和 . _ : -');
  return key;
}

function numberField(value, pattern, minimum, message) {
  if (missing(value)) return null;
  const raw = scalar(value).normalize('NFKC');
  const numeric = Number(raw);
  if (!pattern.test(raw) || !Number.isFinite(numeric) || numeric < minimum) throw Error(message);
  return numeric;
}

function yearField(value, message) {
  return numberField(value, /^\d{4}$/, 1000, message);
}

function pageField(value, minimum, message) {
  const page = numberField(value, /^\d+$/, minimum, message);
  if (page != null && !Number.isSafeInteger(page)) throw Error(message);
  return page;
}

function doiField(value) {
  if (missing(value)) return '';
  const doi = trimmed(value)
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, '').toLowerCase();
  if (!/^10\.\d{4,}(?:\.\d+)*\/[^\s\x00-\x1f\x7f]+$/.test(doi)) throw Error('DOI 格式不合法');
  return doi;
}

function urlField(value) {
  if (missing(value)) return '';
  const url = trimmed(value);
  if (!/^https?:\/\/[^/\s\\]/i.test(url) || /[\x00-\x20\x7f\\]/.test(url)) throw Error('请输入有效的 HTTP 或 HTTPS 链接');
  const parsed = new URL(url);
  if (parsed.username || parsed.password) throw Error('链接不能包含登录凭据');
  return url;
}

function pathField(value, extension, message) {
  if (missing(value)) return '';
  const path = trimmed(value).replace(/\\/g, '/');
  if (!path.toLowerCase().endsWith(extension) || /[:<>"|?*\x00-\x1f\x7f]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw Error(message);
  return path;
}

function itemKey(value) {
  const raw = trimmed(value);
  const uri = /^(?:https?:\/\/(?:www\.)?zotero\.org\/(?:users|groups)\/[^?#]+\/items\/|zotero:\/\/select\/(?:library|groups\/\d+)\/items\/)([a-z0-9]{8})\/?$/i.exec(raw);
  if (uri) return uri[1].toUpperCase();
  return /^[a-z0-9]{8}$/i.test(raw) ? raw.toUpperCase() : '';
}

const metricReaders = {
  impactFactor: value => numberField(value, /^(?:\d+(?:\.\d+)?|\.\d+)$/, 0, '影响因子必须为非负数字'),
  jcrQuartile(value) {
    if (missing(value)) return '';
    const quartile = trimmed(value).normalize('NFKC').toUpperCase();
    if (!/^Q[1-4]$/.test(quartile)) throw Error('JCR 分区必须为 Q1–Q4');
    return quartile;
  },
  casMajor: trimmed,
  casMinor: trimmed,
  metricsYear: value => yearField(value, '指标年份必须为四位数'),
  metricsSource: trimmed
};

function normalizeLiteratureRecord(input) {
  const title = trimmed(input?.title);
  if (!title) throw Error('请输入文献标题');
  const status = trimmed(input.status) || 'unread';
  if (!statuses.has(status)) throw Error('阅读状态不合法');
  const currentPage = pageField(input.currentPage, 0, '当前页必须为非负整数');
  const totalPages = pageField(input.totalPages, 1, '总页数必须为正整数');
  if (currentPage != null && totalPages != null && currentPage > totalPages) throw Error('当前页不能超过总页数');

  const metrics = {};
  for (const [key, read] of Object.entries(metricReaders)) metrics[key] = read(input.metrics?.[key]);
  const fieldSources = {};
  for (const key of metricFields) {
    const source = trimmed(input.metrics?.fieldSources?.[key]);
    if (source && !missing(metrics[key])) fieldSources[key] = source;
  }
  if (Object.keys(fieldSources).length) metrics.fieldSources = fieldSources;

  return {
    title, authors: trimmed(input.authors), publicationTitle: trimmed(input.publicationTitle),
    publicationYear: yearField(input.publicationYear, '发表年份必须为四位数'),
    doi: doiField(input.doi), url: urlField(input.url), zoteroKey: itemKey(input.zoteroKey),
    collections: labels(input.collections), tags: labels(input.tags), citationKey: citationKey(input.citationKey),
    metrics, status, currentPage, totalPages,
    notePath: pathField(input.notePath, '.md', '笔记路径必须为仓库内的相对 Markdown 路径'),
    pdfPath: pathField(input.pdfPath, '.pdf', 'PDF 路径必须为仓库内的相对 PDF 路径')
  };
}

function readingPercent(record) {
  if (record.status === 'finished') return 100;
  if (record.currentPage != null && record.totalPages > 0) return Math.round(record.currentPage * 100 / record.totalPages);
  return record.status === 'unread' && !record.currentPage ? 0 : null;
}

function literatureBibTeX(paper) {
  const key = paper.citationKey || 'todo-' + paper.id.replace(/[^\w-]/g,'');
  const type = paper.publicationTitle ? 'article' : 'misc';
  const latex = {'\\':'\\textbackslash{}','{':'\\{','}':'\\}','^':'\\textasciicircum{}','~':'\\textasciitilde{}'};
  const fields = [
    ['title',paper.title], ['author',(paper.authors||'').split(/;\s*/).filter(Boolean).join(' and ')],
    ['journal',paper.publicationTitle], ['year',paper.publicationYear], ['doi',paper.doi], ['url',paper.url]
  ].filter(([,value]) => value).map(([field,value]) => {
    const text = String(value).replace(/\s+/g,' ').replace(/[\\{}&%$#_^~]/g,char=>latex[char] || '\\'+char);
    return `  ${field} = {${text}}`;
  });
  return `@${type}{${key},\n${fields.join(',\n')}\n}`;
}

function readOptional(reader, value) {
  try {
    return reader(value);
  } catch {
    return undefined;
  }
}

function findLiteratureDuplicate(records, incoming) {
  const entries = Array.from(records);
  const key = itemKey(incoming.zoteroKey);
  const doi = readOptional(doiField, incoming.doi);
  const title = folded(incoming.title);
  const year = scalar(incoming.publicationYear);
  const authors = folded(incoming.authors);

  const byKey = key && entries.find(record => itemKey(record.zoteroKey) === key);
  if (byKey) return byKey;
  const byDoi = doi && entries.find(record => readOptional(doiField, record.doi) === doi);
  if (byDoi) return byDoi;

  if (!title || !year && !authors) return undefined;
  return entries.find(record => {
    if (folded(record.title) !== title || doi && readOptional(doiField, record.doi)) return false;
    const otherYear = scalar(record.publicationYear);
    const otherAuthors = folded(record.authors);
    if (year && otherYear && year !== otherYear || authors && otherAuthors && authors !== otherAuthors) return false;
    return Boolean(year && year === otherYear || authors && authors === otherAuthors);
  });
}

const aliases = {
  impactFactor: ['影响因子', 'Impact Factor', 'IF', 'JIF', 'SCIIF'],
  jcrQuartile: ['JCR分区', 'JCR Quartile', 'JCR', 'SCI分区', 'SCI'],
  casMajor: ['中科院分区升级版', '中科院大类分区', '中科院升级版大类分区', '中科院升级', 'CAS 大类',
    'CAS Major Category', 'CAS Major', 'CAS Quartile', 'SCI Up', 'XR'],
  casMinor: ['中科院升级版小类分区', '中科院小类分区', '升级小类', 'CAS 小类', 'CAS Minor Category',
    'CAS Minor', 'SCI Up Small', 'XR Small'],
  metricsYear: ['指标年份', '指标年度', 'Metric Year', 'Metrics Year', 'JCR Year', 'JCR年度', 'JCR年份'],
  metricsSource: ['指标来源', 'Metric Source', 'Metrics Source', 'Journal Metrics Source', '期刊指标来源']
};
const metricKeys = new Map(Object.entries(aliases)
  .flatMap(([key, labels]) => labels.map(label => [headerKey(label), key])));
const otherExtraLabels = [
  '5年影响因子', '5 Year Impact Factor', '5 Year IF', 'SCIIF(5)', '复合影响因子', '综合影响因子',
  '中科院分区基础版', '中科院升级版Top分区', '中科院升级版Top', '中科院预警', 'EI', 'ESI', 'CCF',
  'SSCI', 'AHCI', 'CSCD', 'JCI', 'PKU Core', 'NJU Core', 'CiteScore', 'SJR', 'AJG', 'UTD24', 'FT50', 'FMS',
  '中文核心期刊/北大核心', 'CSSCI/南大核心', '中国科技核心期刊',
  'Citation Key', 'PMID', 'PMCID', 'Publisher', 'DOI', 'ISSN', 'ISBN'
];
const escapeRegExp = value => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
const labelPattern = [...Object.values(aliases).flat(), ...otherExtraLabels]
  .sort((a, b) => b.length - a.length)
  .map(label => escapeRegExp(label).replace(/ /g, '\\s*')).join('|');
const extraFieldPattern = new RegExp('(?:^|[\\s;；])(' + labelPattern + ')\\s*[:：=]', 'gi');
const tagPattern = new RegExp('^(?:\\[(' + labelPattern + ')\\]|(' + labelPattern
  + ')(?:\\s*[:：=]\\s*|\\s+))\\s*(.+)$', 'i');

function setImportedMetric(metrics, key, value) {
  if (!key || !missing(metrics[key])) return;
  if (key === 'casMajor' || key === 'casMinor') {
    value = scalar(value);
    if (!/(?:[1-4一二三四]\s*区|^[1-4]$)/.test(value.normalize('NFKC'))) return;
  }
  const imported = readOptional(metricReaders[key], value);
  if (!missing(imported)) metrics[key] = imported;
}

function noteText(note) {
  return trimmed(isObject(note) ? note.note : note)
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, entity => ({
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
    })[entity.toLowerCase()]);
}

function applyExtraMetrics(metrics, text) {
  for (const line of text.split(/\r?\n/)) {
    // The native CSV exporter replaces line breaks in Extra with spaces.
    const labels = [...line.matchAll(extraFieldPattern)];
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const key = metricKeys.get(headerKey(label[1]));
      const value = line.slice(label.index + label[0].length, labels[i + 1]?.index)
        .trim().replace(/[;；]+$/, '').trim();
      setImportedMetric(metrics, key, value);
    }
  }
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function importMetrics(fields, notes, tags) {
  const metrics = {};
  const structured = fields.get('metrics');
  if (isObject(structured)) {
    for (const [label, value] of Object.entries(structured)) setImportedMetric(metrics, metricKeys.get(headerKey(label)), value);
  }
  for (const [label, value] of fields) setImportedMetric(metrics, metricKeys.get(label), value);
  for (const note of notes) applyExtraMetrics(metrics, noteText(note));
  for (const tag of tags) {
    const match = tagPattern.exec(trimmed(isObject(tag) ? tag.tag : tag));
    if (match) setImportedMetric(metrics, metricKeys.get(headerKey(match[1] || match[2])), match[3]);
  }
  return metrics;
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;

  function pushField() {
    row.push(value);
    value = '';
    closedQuote = false;
  }

  function pushRow() {
    pushField();
    if (row.length > 1 || row[0].trim()) rows.push(row);
    row = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[index + 1] === '"') {
        value += char;
        index += 1;
      } else {
        quoted = false;
        closedQuote = true;
      }
    } else if (char === ',') {
      pushField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
    } else if (char === '"' && !value && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote || char === '"') throw Error('CSV 字段中的引号格式不合法');
      value += char;
    }
  }
  if (quoted) throw Error('CSV 字段的引号未闭合');
  pushRow();

  const headers = rows.shift()?.map(headerKey) || [];
  if (!headers.includes('title') || new Set(headers).size !== headers.length) throw Error('CSV 表头需要唯一的 Title 列');
  return rows.map(rowValues => {
    if (rowValues.length !== headers.length) throw Error('CSV 行的列数与表头不一致');
    return Object.fromEntries(headers.map((header, index) => [header, rowValues[index]]));
  });
}

function parseJson(text, message) {
  try {
    return JSON.parse(text);
  } catch {
    throw Error(message);
  }
}

function jsonRows(text) {
  const json = parseJson(text, 'Zotero JSON 文件格式不合法');
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.data)) return json.data;
  if (isObject(json) && (Object.hasOwn(json, 'title') || isObject(json.data) && (json.data.title || json.data.itemType))) return [json];
  throw Error('JSON 文件缺少 Zotero 或 CSL 文献条目');
}

function publicationYear(...values) {
  for (const value of values) {
    const year = /(?:^|[^\d])([1-9]\d{3})(?:$|[^\d])/.exec(scalar(value))?.[1];
    if (year) return Number(year);
  }
  return null;
}

function authorsFrom(value) {
  if (!Array.isArray(value)) return trimmed(value);
  return value.filter(author => !author?.creatorType || author.creatorType === 'author').map(author => {
    if (!isObject(author)) return trimmed(author);
    return trimmed(author.name || author.literal)
      || [trimmed(author.family || author.lastName), trimmed(author.given || author.firstName)].filter(Boolean).join(', ');
  }).filter(Boolean).join('; ');
}

function zoteroEntry(row, childNotes) {
  const item = isObject(row.data) ? row.data : row;
  const fields = new Map(Object.entries(item).map(([key, value]) => [headerKey(key), value]));
  const field = (...keys) => keys.map(key => fields.get(key)).find(value => !missing(value));
  const title = trimmed(field('title'));
  if (!title || ['note', 'attachment', 'annotation'].includes(field('itemtype')) || item.deleted) return null;
  const key = itemKey(row.key) || itemKey(field('key', 'zoterokey', 'uri')) || (/[:/]/.test(trimmed(item.id)) ? itemKey(item.id) : '');
  const notes = [field('extra'), field('note'), ...list(field('notes')), ...(childNotes.get(key) || [])];
  const tags = [...list(field('tags')), ...['manualtags', 'automatictags'].flatMap(key => trimmed(field(key)).split(/;[ \t]*/))];
  const topicTags = tags.map(tag=>trimmed(tag?.tag ?? tag)).filter(tag=>{
    const found={};
    applyExtraMetrics(found,tag);
    return !Object.keys(found).length;
  });
  const exportedKey = field('citationkey') || /(?:^|\n)Citation Key\s*:\s*(\S+)/i.exec(trimmed(field('extra')))?.[1];
  const issued = field('issued');
  return normalizeLiteratureRecord({
    title, authors: authorsFrom(field('author', 'authors', 'creators')),
    publicationTitle: field('publicationtitle', 'containertitle', 'conferencename'),
    publicationYear: publicationYear(field('publicationyear'), issued?.['date-parts']?.[0]?.[0], field('date', 'publicationdate'), issued?.raw, issued?.literal),
    doi: readOptional(doiField, field('doi')), url: readOptional(urlField, field('url')),
    zoteroKey: key, totalPages: readOptional(value => pageField(value, 1, ''), field('numpages', 'numberofpages')),
    citationKey: readOptional(citationKey,exportedKey), tags:topicTags,
    metrics: importMetrics(fields, notes, tags)
  });
}

function parseZoteroExport(value, format) {
  const text = trimmed(value);
  if (!text) throw Error('Zotero 导出文件为空');
  const kind = format ? String(format).toLowerCase() : /^[{\[]/.test(text) ? 'json' : 'csv';
  if (kind !== 'json' && kind !== 'csv') throw Error('请选择 Zotero CSV 或 JSON 导出文件');
  const rows = kind === 'csv' ? csvRows(text) : jsonRows(text);
  const childNotes = new Map();
  for (const row of rows) {
    const item = row?.data ?? row;
    const parent = itemKey(item?.parentItem);
    if (item?.itemType !== 'note' || !parent || item.deleted) continue;
    if (!childNotes.has(parent)) childNotes.set(parent, []);
    childNotes.get(parent).push(item.note);
  }

  const records = [];
  for (const row of rows) {
    const record = isObject(row) && zoteroEntry(row, childNotes);
    if (record) records.push(record);
  }
  return { records, skipped: rows.length - records.length };
}

function applyJournalTagsCache(records, value) {
  const message = 'Journal Tags 缓存文件格式不合法';
  const raw = parseJson(trimmed(value), message);
  if (!isObject(raw)) throw Error(message);

  const exact = new Map();
  const normalized = new Map();
  for (const [title, entry] of Object.entries(raw)) {
    if (entry === '') continue;
    if (!isObject(entry)) throw Error(message);
    const metrics = {};
    for (const [key, values] of [
      ['impactFactor', [entry.sciif]], ['jcrQuartile', [entry.sci, entry.ssci]],
      ['casMajor', [entry.xr, entry.sciUp]], ['casMinor', [entry.xrSmall, entry.sciUpSmall]]
    ]) {
      for (const field of values) setImportedMetric(metrics, key, field);
    }
    if (!Object.keys(metrics).length) continue;
    exact.set(title.trim(), metrics);
    const lookup = folded(title);
    normalized.set(lookup, normalized.has(lookup) ? null : metrics);
  }

  let matched = 0;
  let enriched = 0;
  const updated = records.map(record => {
    const title = trimmed(record.publicationTitle);
    const entry = title && (exact.get(title) || normalized.get(folded(title)));
    if (!entry) return record;
    matched += 1;
    const metrics = { ...record.metrics };
    const filled = Object.keys(entry).filter(key => missing(metrics[key]));
    if (!filled.length) return record;
    if (!metrics.metricsSource && metrics.metricsYear == null && metricFields.every(key => missing(metrics[key]))) {
      metrics.metricsSource = cacheSource;
    }
    metrics.fieldSources = { ...metrics.fieldSources };
    for (const key of filled) {
      metrics[key] = entry[key];
      metrics.fieldSources[key] = cacheSource;
    }
    enriched += 1;
    return { ...record, metrics };
  });

  return { records: updated, matched, enriched };
}

module.exports = { normalizeLiteratureRecord, readingPercent, literatureBibTeX, findLiteratureDuplicate, parseZoteroExport, applyJournalTagsCache };
