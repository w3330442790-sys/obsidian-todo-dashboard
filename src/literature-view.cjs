'use strict';

const {uid} = require('./core.cjs');
const L = require('./literature.cjs');

const STATUSES = {unread:'待读', reading:'阅读中', finished:'已读'};
const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'];
const activePapers = plugin => [...plugin.store.literature.values()].filter(paper => !paper.deleted);

function renderLiterature(view, parent, ui) {
  const {el, button, heading, select, empty} = ui;
  const plugin = view.plugin;
  const state = view.state.literature ??= {query:'', status:'', quartile:'', order:'recent', limit:50};
  heading(parent, 'READING LIBRARY', '文献专区', '整理期刊指标、原文与阅读进度。', '📑');
  const actions = el(parent, 'div', 'td-toolbar');
  button(actions, '添加文献', () => plugin.editLiterature(), 'mod-cta', '＋');
  button(actions, '导入 Zotero', () => plugin.importLiterature(), '', '📥');

  const filters = el(parent, 'div', 'td-toolbar td-lit-filters');
  const search = el(filters, 'input', 'td-input');
  search.type = 'search';
  search.value = state.query;
  search.placeholder = '搜索标题、作者、期刊、DOI 或分区';
  search.setAttribute('aria-label', '搜索文献');
  const count = el(parent, 'p', 'td-muted');
  const list = el(parent, 'div', 'td-lit-list');
  function setFilter(key, value) {
    state[key] = value;
    state.limit = 50;
    show();
  }
  search.addEventListener('input', () => setFilter('query', search.value));
  for (const [key, label, options] of [
    ['status', '阅读状态筛选', [['','全部阅读状态'], ...Object.entries(STATUSES)]],
    ['quartile', 'JCR 分区筛选', [['','全部 JCR 分区'], ...QUARTILES.map(q => [q,q]), ['unknown','未记录分区']]],
    ['order', '文献排序', [['recent','最近更新'], ['impact','影响因子'], ['year','发表年份']]]
  ]) select(filters, options, state[key], value => setFilter(key, value)).setAttribute('aria-label', label);

  function show() {
    list.replaceChildren();
    const papers = activePapers(plugin);
    const query = state.query.trim().toLowerCase();
    const filtered = papers.filter(paper => {
      if (state.status && paper.status !== state.status) return false;
      if (state.quartile && (paper.metrics.jcrQuartile || 'unknown') !== state.quartile) return false;
      return [paper.title, paper.authors, paper.publicationTitle, paper.doi,
        paper.metrics.jcrQuartile, paper.metrics.casMajor, paper.metrics.casMinor].some(value => value.toLowerCase().includes(query));
    });
    filtered.sort((a,b) => {
      if (state.order === 'impact') return (b.metrics.impactFactor ?? -1) - (a.metrics.impactFactor ?? -1);
      if (state.order === 'year') return (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    count.textContent = `符合筛选 ${filtered.length} 条 · 共 ${papers.length} 条`;
    if (!filtered.length) empty(list, papers.length ? '没有符合筛选条件的文献。' : '添加一篇文献，或导入 Zotero 导出文件。');
    for (const paper of filtered.slice(0,state.limit)) renderPaper(plugin,list,paper,ui);
    if (filtered.length > state.limit) button(list, '显示更多', () => { state.limit += 50; show(); });
  }
  show();
}

function renderPaper(plugin, parent, paper, {el, button}) {
  const card = el(parent, 'article', 'td-panel td-lit-paper');
  el(card, 'h3', '', paper.title);
  el(card, 'p', 'td-muted', [paper.authors, paper.publicationTitle, paper.publicationYear].filter(Boolean).join(' · '));
  const tags = el(card, 'div', 'td-lit-tags');
  const metrics = paper.metrics;
  for (const [key, label] of [
    ['impactFactor', metrics.impactFactor == null ? '' : `IF ${metrics.impactFactor}`],
    ['jcrQuartile', metrics.jcrQuartile ? `JCR ${metrics.jcrQuartile}` : ''],
    ['casMajor', metrics.casMajor ? `中科院大类 ${metrics.casMajor}` : ''],
    ['casMinor', metrics.casMinor ? `中科院小类 ${metrics.casMinor}` : '']
  ]) {
    if (!label) continue;
    const badge = el(tags, 'span', 'td-lit-tag', label);
    badge.dataset.metric = key === 'jcrQuartile' ? metrics.jcrQuartile : key;
    badge.title = metrics.fieldSources?.[key] || [metrics.metricsYear, metrics.metricsSource].filter(Boolean).join(' · ');
  }
  if (!tags.childElementCount) el(tags, 'span', 'td-muted', '暂无期刊指标');
  else if (metrics.metricsYear || metrics.metricsSource) el(tags, 'small', 'td-muted',
    [metrics.metricsYear && `${metrics.metricsYear} 年指标`, metrics.metricsSource].filter(Boolean).join(' · '));

  const progress = el(card, 'div', 'td-lit-progress');
  const percent = L.readingPercent(paper);
  const pages = paper.currentPage == null ? '' : paper.totalPages == null ? `第 ${paper.currentPage} 页` : `${paper.currentPage} / ${paper.totalPages} 页`;
  el(progress, 'span', '', [STATUSES[paper.status], pages, percent == null ? '' : `${percent}%`].filter(Boolean).join(' · '));
  if (percent != null) {
    const bar = el(progress, 'progress', '');
    bar.max = 100;
    bar.value = percent;
    bar.setAttribute('aria-label', '阅读进度');
  }
  const actions = el(card, 'div', 'td-lit-actions');
  button(actions, '记录进度', () => plugin.readingProgress(paper));
  button(actions, '编辑文献', () => plugin.editLiterature(paper), 'td-link');
  for (const [path, label] of [[paper.pdfPath,'打开 PDF'], [paper.notePath,'打开笔记']]) {
    if (!path) continue;
    button(actions, label, () => plugin.run(async () => {
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!file?.extension) throw Error('库内文件未找到：'+path);
      const page = file.extension.toLowerCase() === 'pdf' && paper.currentPage > 0 ? '#page='+paper.currentPage : '';
      await plugin.app.workspace.openLinkText(path+page, '', true);
    }), 'td-link');
  }
  const url = paper.url || (paper.doi ? 'https://doi.org/'+encodeURI(paper.doi) : '');
  if (url) {
    const link = el(actions, 'a', '', '查看原文');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
}

function saveForm(modal, form, save, {el,button}) {
  const error = el(form, 'p', 'td-error');
  error.setAttribute('role', 'alert');
  const actions = el(form, 'div', 'td-modal-actions');
  button(actions, '取消', () => modal.close());
  const submit = button(actions, '保存', () => {}, 'mod-cta');
  submit.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error.textContent = '';
    try { await save(); modal.close(); }
    catch (failure) { error.textContent = failure.message; }
    finally { submit.disabled = false; }
  };
  return actions;
}

function editLiterature(plugin, root, modal, paper, ui) {
  const {el, button, formField, formSelect} = ui;
  const token = paper && plugin.store.token('literature',paper.id);
  const form = el(root, 'form', 'td-form');
  const title = formField(form, '标题', 'text', paper?.title);
  title.required = true;
  const fields = el(form, 'div', 'td-lit-form-grid');
  const inputs = Object.fromEntries([
    ['authors','作者'], ['publicationTitle','期刊'], ['publicationYear','发表年份'],
    ['doi','DOI'], ['url','原文链接'], ['pdfPath','库内 PDF 路径'], ['notePath','库内笔记路径']
  ].map(([key,label]) => [key,formField(fields,label,'text',paper?.[key])]));
  const metricFields = el(form, 'div', 'td-lit-form-grid');
  const metrics = paper?.metrics || {};
  const metricInputs = Object.fromEntries([
    ['impactFactor','影响因子'], ['casMajor','中科院大类分区'], ['casMinor','中科院小类分区'],
    ['metricsYear','指标年份'], ['metricsSource','指标来源']
  ].map(([key,label]) => [key,formField(metricFields,label,'text',metrics[key])]));
  metricInputs.jcrQuartile = formSelect(metricFields,'JCR 分区',[['','未记录'],...QUARTILES.map(q=>[q,q])],metrics.jcrQuartile||'');
  const values = controls => Object.fromEntries(Object.entries(controls).map(([key,input]) => [key,input.value]));
  const actions = saveForm(modal,form,async () => {
    const entered = values(metricInputs);
    const sources = {...metrics.fieldSources};
    for (const key of Object.keys(sources)) {
      if (String(metrics[key] ?? '') !== entered[key]) delete sources[key];
    }
    await savePaper(plugin,paper,{title:title.value,...values(inputs),metrics:{...entered,fieldSources:sources}},token);
    plugin.refresh();
  },ui);
  if (paper) {
    const remove = button(actions, '移出专区', () => {
      remove.remove();
      el(form,'p','td-muted','确认将这篇文献移出专区？');
      const confirm = button(actions, '确认移出', async () => {
        confirm.disabled = true;
        await plugin.run(async () => {
          await plugin.store.saveLiterature({...paper,deleted:true},token);
          plugin.refresh();
          modal.close();
        });
        confirm.disabled = false;
      },'mod-warning');
    },'td-link');
  }
}

function editProgress(plugin, root, modal, paper, ui) {
  const {el, formField, formSelect} = ui;
  const token = plugin.store.token('literature',paper.id);
  el(root, 'p', '', paper.title);
  const form = el(root, 'form', 'td-form');
  const status = formSelect(form, '阅读状态', Object.entries(STATUSES), paper.status);
  const currentPage = formField(form, '已读至页', 'number', paper.currentPage);
  const totalPages = formField(form, '总页数', 'number', paper.totalPages);
  currentPage.min = '0';
  totalPages.min = '1';
  saveForm(modal,form,async () => {
    await savePaper(plugin,paper,{
      status:status.value,
      currentPage:status.value === 'finished' && totalPages.value ? totalPages.value : currentPage.value,
      totalPages:totalPages.value
    },token);
    plugin.refresh();
  },ui);
}

async function savePaper(plugin, original, patch, token) {
  const normalized = L.normalizeLiteratureRecord({...original,...patch});
  const now = new Date().toISOString();
  await plugin.store.saveLiterature({
    ...normalized, id:original?.id || uid(), createdAt:original?.createdAt || now, updatedAt:now
  },token);
}

function importLiterature(plugin, root, modal, {el,button,formField}) {
  el(root,'p','td-muted','可导入 Zotero 的 CSV 或 JSON。期刊指标来自导出字段或 Journal Tags 缓存；缺失指标可以稍后编辑。');
  const source = formField(root,'Zotero 导出文件','file');
  source.accept = '.csv,.json';
  const cache = formField(root,'Journal Tags 缓存（可选）','file');
  cache.accept = '.json';
  const result = el(root,'div','td-lit-import-preview');
  const status = el(root,'p','td-muted');
  status.setAttribute('role','status');
  const error = el(root,'p','td-error');
  error.setAttribute('role','alert');
  const actions = el(root,'div','td-modal-actions');
  let prepared;
  let saved = 0;
  const update = () => { prepared = null; saved = 0; result.replaceChildren(); error.textContent = status.textContent = ''; apply.disabled = true; };
  for (const file of [source,cache]) file.addEventListener('change',update);
  button(actions,'取消',()=>modal.close());
  const preview = button(actions,'预览导入',async()=>{
    update();
    preview.disabled = source.disabled = cache.disabled = true;
    try {
      const zoteroFile = source.files[0], cacheFile = cache.files[0];
      if (!zoteroFile && !cacheFile) throw Error('请选择 Zotero 导出文件或 Journal Tags 缓存');
      for (const file of [zoteroFile,cacheFile]) if (file?.size > 20*1024*1024) throw Error('单个文件请小于 20 MB');
      const current = activePapers(plugin);
      if (zoteroFile) {
        const format = zoteroFile.name.toLowerCase().split('.').pop();
        const parsed = L.parseZoteroExport(await zoteroFile.text(),format);
        const matched = cacheFile ? L.applyJournalTagsCache(parsed.records,await cacheFile.text()) : null;
        const known = [...current];
        const records = [];
        for (const paper of matched?.records || parsed.records) {
          if (L.findLiteratureDuplicate(known,paper)) continue;
          known.push(paper);
          records.push({patch:paper});
        }
        prepared = records;
        status.textContent = `新增 ${records.length} 条 · 重复 ${parsed.records.length-records.length} 条 · 跳过 ${parsed.skipped} 条`+
          (matched ? ` · 缓存补充 ${matched.enriched} 条` : '');
      } else {
        const matched = L.applyJournalTagsCache(current,await cacheFile.text());
        prepared = matched.records.flatMap((paper,index) => {
          const original = current[index];
          return JSON.stringify(paper.metrics) === JSON.stringify(original.metrics) ? [] :
            [{original,patch:{metrics:paper.metrics},token:plugin.store.token('literature',original.id)}];
        });
        status.textContent = `缓存匹配 ${matched.matched} 条 · 可补充指标 ${prepared.length} 条`;
      }
      for (const {original,patch} of prepared.slice(0,8)) el(result,'div','',patch.title || original.title);
      apply.disabled = !prepared.length;
    } catch (failure) { error.textContent = failure.message; }
    finally { preview.disabled = source.disabled = cache.disabled = false; }
  });
  const apply = button(actions,'确认导入',async()=>{
    if (!prepared || apply.disabled) return;
    apply.disabled = preview.disabled = source.disabled = cache.disabled = true;
    error.textContent = '';
    try {
      while (saved < prepared.length) {
        const {original,patch,token} = prepared[saved];
        if (original || !L.findLiteratureDuplicate(activePapers(plugin),patch)) await savePaper(plugin,original,patch,token);
        saved++;
      }
      modal.close();
    } catch (failure) {
      error.textContent = `已处理 ${saved} 条。 ${failure.message}`;
    } finally {
      plugin.refresh();
      apply.disabled = preview.disabled = source.disabled = cache.disabled = false;
    }
  },'mod-cta');
  apply.disabled = true;
}

module.exports = {renderLiterature,editLiterature,editProgress,importLiterature};
