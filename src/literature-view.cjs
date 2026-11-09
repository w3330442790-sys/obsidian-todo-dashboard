'use strict';

const {uid} = require('./core.cjs');
const L = require('./literature.cjs');
const {consoleUrl, rankEntries, refreshRanks, savePaperRank} = require('./easyscholar.cjs');

const STATUSES = {unread:'待读', reading:'阅读中', finished:'已读'};
const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'];
const activePapers = plugin => [...plugin.store.literature.values()].filter(paper => !paper.deleted);

function renderLiterature(view, parent, ui) {
  const {el, button, heading, select, empty} = ui;
  const plugin = view.plugin;
  const state = view.state.literature ??= {query:'', status:'', quartile:'', collection:'', tag:'', order:'recent', limit:50};
  heading(parent, 'READING LIBRARY', '文献专区', '整理期刊指标、原文与阅读进度。', '📑');
  const actions = el(parent, 'div', 'td-toolbar');
  button(actions, '添加文献', () => plugin.editLiterature(), 'mod-cta', '＋');
  button(actions, '导入 PDF', () => plugin.showLiteraturePdfImport(), '', '📄');
  button(actions, '导入 Zotero', () => plugin.importLiterature(), '', '📥');
  button(actions, 'EasyScholar', () => plugin.showEasyScholar());

  const filters = el(parent, 'div', 'td-toolbar td-lit-filters');
  const search = el(filters, 'input', 'td-input');
  search.type = 'search';
  search.value = state.query;
  search.placeholder = '搜索标题、作者、期刊、DOI、分区或标签';
  search.setAttribute('aria-label', '搜索文献');
  const count = el(parent, 'p', 'td-muted');
  const list = el(parent, 'div', 'td-lit-list');
  function setFilter(key, value) {
    state[key] = value;
    state.limit = 50;
    show();
  }
  search.addEventListener('input', () => setFilter('query', search.value));
  const optionsFor = (key,stateKey,label) => {
    const values = [...new Set(activePapers(plugin).flatMap(paper=>paper[key]))].sort((a,b)=>a.localeCompare(b,'zh'));
    if(!values.includes(state[stateKey])) state[stateKey]='';
    return [['',label],...values.map(value=>[value,value])];
  };
  for (const [key, label, options] of [
    ['collection','分类筛选',optionsFor('collections','collection','全部分类')],
    ['tag','标签筛选',optionsFor('tags','tag','全部标签')],
    ['status', '阅读状态筛选', [['','全部阅读状态'], ...Object.entries(STATUSES)]],
    ['quartile', 'JCR 分区筛选', [['','全部 JCR 分区'], ...QUARTILES.map(q => [q,q]), ['unknown','未记录分区']]],
    ['order', '文献排序', [['recent','最近更新'], ['impact','影响因子'], ['year','发表年份']]]
  ]) select(filters, options, state[key], value => setFilter(key, value)).setAttribute('aria-label', label);

  function show() {
    list.replaceChildren();
    const papers = activePapers(plugin);
    const query = state.query.trim().toLowerCase();
    const filtered = papers.map(paper => ({paper,metrics:L.effectiveLiteratureMetrics(paper)})).filter(({paper,metrics}) => {
      if (state.status && paper.status !== state.status) return false;
      if (state.quartile && (metrics.jcrQuartile || 'unknown') !== state.quartile) return false;
      if (state.collection && !paper.collections.includes(state.collection)) return false;
      if (state.tag && !paper.tags.includes(state.tag)) return false;
      return [paper.title, paper.authors, paper.publicationTitle, paper.doi,
        metrics.jcrQuartile, metrics.casMajor, metrics.casMinor,
        ...(query && paper.easyScholar ? rankEntries(paper.easyScholar).map(({label,value}) => label+' '+value) : []),
        ...paper.collections,...paper.tags].some(value => value.toLowerCase().includes(query));
    });
    filtered.sort((a,b) => {
      if (state.order === 'impact') return (b.metrics.impactFactor ?? -1) - (a.metrics.impactFactor ?? -1);
      if (state.order === 'year') return (b.paper.publicationYear ?? 0) - (a.paper.publicationYear ?? 0);
      return (b.paper.updatedAt || '').localeCompare(a.paper.updatedAt || '');
    });
    count.textContent = `符合筛选 ${filtered.length} 条 · 共 ${papers.length} 条`;
    if (!filtered.length) empty(list, papers.length ? '没有符合筛选条件的文献。' : '添加一篇文献，或导入 Zotero 导出文件。');
    for (const {paper,metrics} of filtered.slice(0,state.limit)) renderPaper(plugin,list,paper,metrics,ui);
    if (filtered.length > state.limit) button(list, '显示更多', () => { state.limit += 50; show(); });
  }
  show();
}

function renderPaper(plugin, parent, paper, metrics, {el, button}) {
  const card = el(parent, 'article', 'td-panel td-lit-paper');
  el(card, 'h3', '', paper.title);
  el(card, 'p', 'td-muted', [paper.authors, paper.publicationTitle, paper.publicationYear].filter(Boolean).join(' · '));
  const tags = el(card, 'div', 'td-lit-tags');
  let hasOnlineMetrics = false;
  for (const [key, label] of [
    ['impactFactor', metrics.impactFactor == null ? '' : `IF ${metrics.impactFactor}`],
    ['jcrQuartile', metrics.jcrQuartile ? `JCR ${metrics.jcrQuartile}` : ''],
    ['casMajor', metrics.casMajor ? `中科院大类 ${metrics.casMajor}` : ''],
    ['casMinor', metrics.casMinor ? `中科院小类 ${metrics.casMinor}` : '']
  ]) {
    if (!label) continue;
    const badge = el(tags, 'span', 'td-lit-tag', label);
    badge.dataset.metric = key === 'jcrQuartile' ? metrics.jcrQuartile : key;
    const online = paper.easyScholar && (paper.metrics[key] == null || paper.metrics[key] === '');
    hasOnlineMetrics ||= Boolean(online);
    badge.title = online ? 'EasyScholar · 查询于 ' + queryDate(paper.easyScholar) :
      (metrics.fieldSources?.[key] || [metrics.metricsYear, metrics.metricsSource].filter(Boolean).join(' · '));
  }
  if (!tags.childElementCount) el(tags, 'span', 'td-muted', '暂无期刊指标');
  else if (!hasOnlineMetrics && (metrics.metricsYear || metrics.metricsSource)) el(tags, 'small', 'td-muted',
    [metrics.metricsYear && `${metrics.metricsYear} 年指标`, metrics.metricsSource].filter(Boolean).join(' · '));
  if (paper.easyScholar) renderRankDetails(card,paper.easyScholar,el);
  if(paper.collections.length||paper.tags.length){
    const labels=el(card,'div','td-lit-tags');
    for(const label of paper.collections)el(labels,'span','td-lit-tag','分类 · '+label);
    for(const label of paper.tags)el(labels,'span','td-lit-tag','#'+label);
  }

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
  if(paper.pdfPath)button(actions,paper.currentPage>0?'继续阅读':'打开 PDF',()=>plugin.run(()=>plugin.openLiteraturePdf(paper)),'mod-cta');
  else button(actions,'添加 PDF',()=>plugin.showLiteraturePdfImport(paper),'td-link');
  button(actions,'阅读与翻译',()=>plugin.showLiteratureReader(paper));
  button(actions, '记录进度', () => plugin.readingProgress(paper));
  button(actions, '编辑文献', () => plugin.editLiterature(paper), 'td-link');
  button(actions, '查分区', () => plugin.showEasyScholar(paper.id), 'td-link');
  button(actions,'复制引用',()=>plugin.showLiteratureCitation(paper),'td-link');
  if(paper.notePath)button(actions,'打开笔记',()=>plugin.run(async()=>{
    const file=plugin.app.vault.getAbstractFileByPath(paper.notePath);
    if(!file?.extension)throw Error('库内笔记未找到：'+paper.notePath);
    await plugin.app.workspace.openLinkText(file.path,'',true);
  }),'td-link');
  const url = paper.url || (paper.doi ? 'https://doi.org/'+encodeURI(paper.doi) : '');
  if (url) {
    const link = el(actions, 'a', '', '查看原文');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
}

const queryDate = snapshot => new Date(snapshot.checkedAt).toLocaleDateString('zh-CN');

function renderRankDetails(parent,snapshot,el,expanded = false) {
  const ranks = rankEntries(snapshot);
  const details = el(parent,'details','td-lit-ranks');
  details.open = expanded;
  el(details,'summary','',ranks.length ? `EasyScholar · ${ranks.length} 项` : 'EasyScholar · 未匹配到等级');
  el(details,'p','td-muted',`${snapshot.publicationName} · 查询于 ${queryDate(snapshot)}`);
  const list = el(details,'dl','td-lit-rank-list');
  for (const {label,value,source} of ranks) {
    const term = el(list,'dt','',label);
    term.title = source;
    el(list,'dd','',`${value}（${source.startsWith('自定义') ? '自定义' : '官方'}）`);
  }
}

function showEasyScholar(plugin,root,modal,paperId,{el,button,formField}) {
  const help = el(root,'p','td-muted','查询时会向 EasyScholar 发送 Secret Key 和期刊或会议名称。');
  const link = el(help,'a','','获取 Secret Key');
  link.href = consoleUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const key = formField(root,'EasyScholar Secret Key','password');
  key.autocomplete = 'off';
  const status = el(root,'p','td-muted');
  status.setAttribute('role','status');
  const error = el(root,'p','td-error');
  error.setAttribute('role','alert');
  const output = el(root,'div','');
  const controls = el(root,'div','td-toolbar');
  function showKeyStatus() {
    const configured = Boolean(plugin.easyScholarKey());
    key.placeholder = configured ? '已配置，输入新密钥可替换' : '粘贴开放接口的 Secret Key';
    remove.disabled = !configured;
  }
  function updateKey(value) {
    error.textContent = '';
    try {
      plugin.setEasyScholarKey(value);
      key.value = '';
      showKeyStatus();
      status.textContent = value ? (plugin.app.secretStorage ? '密钥已保存到本机 Obsidian。' : '密钥仅在本次插件运行期间有效。') : '密钥已清除。';
    } catch {
      error.textContent = '无法更新 Obsidian 中的 EasyScholar 密钥。';
    }
  }
  const save = button(controls,'保存密钥',() => {
    if (key.value.trim()) updateKey(key.value.trim());
    else error.textContent = '请粘贴 Secret Key 后再保存。';
  });
  const remove = button(controls,'清除密钥',() => updateKey(''));
  showKeyStatus();
  let paper = paperId && plugin.store.literature.get(paperId);
  const resolver = el(root,'div','td-lit-resolver');
  const term = formField(resolver,'DOI、ISSN、刊名或简称','search',paper?.doi || paper?.publicationTitle);
  term.placeholder = '例如 0028-0836 或刊名';
  const candidates = el(resolver,'div','td-lit-candidates');
  const candidateButtons = [];
  let selection;
  function clearCandidates() {
    candidates.replaceChildren();
    candidateButtons.length = 0;
  }
  const name = formField(root,'期刊或会议名称','text',paper?.publicationTitle);
  name.readOnly = Boolean(paperId);
  function resetSelection() {
    if (selection && name.value === selection.name) name.value = selection.previous;
    selection = undefined;
  }
  term.addEventListener('input',() => {
    clearCandidates();
    resetSelection();
    status.textContent = '';
  });
  const actions = el(root,'div','td-modal-actions');
  let operation;
  const summary = result => `已查询 ${result.queried} / ${result.total} 个来源 · 写入 ${result.saved} 条文献 · 无匹配 ${result.unmatched}` +
    (result.skipped ? ` · 已变更并跳过 ${result.skipped} 条` : '') +
    (result.conflicts ? ` · 保存失败 ${result.conflicts} 条` : '');
  async function run(message,action) {
    if (operation) return;
    operation = new AbortController();
    const {signal} = operation;
    for (const control of [save,remove,query,batch,key,name,term,resolveName,...candidateButtons]) if (control) control.disabled = true;
    stop.disabled = false;
    status.textContent = message;
    error.textContent = '';
    output.replaceChildren();
    try { await action(signal); }
    catch (failure) {
      status.textContent = signal.aborted ? '已停止查询。' : '';
      if (!signal.aborted) error.textContent = failure.message;
    } finally {
      operation = null;
      for (const control of [save,query,batch,key,name,term,resolveName,...candidateButtons]) if (control) control.disabled = false;
      showKeyStatus();
      stop.disabled = true;
    }
  }
  async function updateBatch(signal) {
    const result = await refreshRanks(plugin.store,plugin.easyScholar,activePapers(plugin).map(paper => paper.id),{
      onlyMissing:true,signal,onProgress:progress => { status.textContent = summary(progress); }
    });
    if (result.saved) plugin.refresh();
    status.textContent = (signal.aborted ? '已停止 · ' : '') +
      (result.total ? summary(result) : '没有可查询的文献。');
    if (result.error && !signal.aborted) error.textContent = result.error;
    if (result.conflicts && !signal.aborted) el(output,'p','td-muted','保存失败的文献可以刷新列表后重试。');
  }
  const resolveName = button(resolver,'在 Crossref 查刊名',() => run('正在查询 Crossref…',async signal => {
    clearCandidates();
    resetSelection();
    const results = await plugin.publicationLookup.lookup(term.value,{signal});
    if (signal.aborted) { status.textContent = '已停止查询。'; return; }
    status.textContent = results.length ? '请选择一个刊名，再查询分区。' : '没有匹配的来源，可以换一个检索词或直接使用已知刊名。';
    for (const candidate of results) {
      const row = el(candidates,'div','td-lit-candidate');
      const selectName = button(row,candidate.name,() => {
        selection = {name:candidate.name,previous:name.value};
        name.value = candidate.name;
        clearCandidates();
        status.textContent = paper && paper.publicationTitle !== candidate.name ?
          `已选 ${candidate.name}。查到分区后会一并更新文献的刊名。` : `已选 ${candidate.name}。`;
      });
      candidateButtons.push(selectName);
      const labels = [...candidate.aliases,...candidate.issns,candidate.publisher].filter(Boolean);
      if (labels.length) el(row,'small','td-muted',labels.join(' · '));
    }
  }));
  const query = button(actions,paperId ? '查询并保存' : '查询分区',() => run('正在查询 EasyScholar…',async signal => {
    if (!name.value.trim()) throw Error('请填写期刊或会议名称，或先在 Crossref 选择一个结果。');
    if (paperId && !paper) throw Error('这篇文献已移出专区。');
    const result = paperId ?
      await savePaperRank(plugin.store,plugin.easyScholar,paper,name.value,{signal}) :
      {snapshot:await plugin.easyScholar.lookup(name.value),saved:false};
    if (result.saved) {
      paper = plugin.store.literature.get(paperId);
      selection = undefined;
      plugin.refresh();
    }
    if (signal.aborted) { status.textContent = '已停止查询。'; return; }
    status.textContent = result.saved ? '已保存查询结果。' : paperId ? '未匹配到等级，已保留原有记录。' : '';
    renderRankDetails(output,result.snapshot,el,true);
  }),'mod-cta');
  const batch = !paperId && button(actions,'批量查询未查文献',() =>
    run('正在查询 EasyScholar…',updateBatch));
  const stop = button(actions,'停止查询',() => {
    operation?.abort();
    status.textContent = '正在停止查询…';
    stop.disabled = true;
  });
  stop.disabled = true;
  button(actions,'关闭',() => modal.close());
  el(root,'p','td-muted','只有点击「在 Crossref 查刊名」时才会发送检索词。EasyScholar 密钥只用于 EasyScholar 查询。');
  if (!paperId) el(root,'p','td-muted','批量查询适用于所有尚无 EasyScholar 查询记录、且已填写期刊或会议名称的文献。');
  if (paper?.easyScholar) renderRankDetails(output,paper.easyScholar,el,true);
  return () => operation?.abort();
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
    ['authors','作者'], ['publicationTitle','期刊或会议'], ['publicationYear','发表年份'],
    ['doi','DOI'], ['url','原文链接'], ['pdfPath','库内 PDF 路径'], ['notePath','库内笔记路径'],
    ['citationKey','引用键（可选）']
  ].map(([key,label]) => [key,formField(fields,label,'text',paper?.[key])]));
  inputs.collections=formField(fields,'文献分类（用分号分隔）','text',paper?.collections.join('；'));
  inputs.tags=formField(fields,'主题标签（用分号分隔）','text',paper?.tags.join('；'));
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

module.exports = {renderLiterature,showEasyScholar,editLiterature,editProgress,importLiterature};
