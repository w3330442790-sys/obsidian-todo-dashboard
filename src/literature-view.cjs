'use strict';

const {uid} = require('./core.cjs');
const L = require('./literature.cjs');
const Library = require('./literature-library.cjs');
const {prepareLiteratureImport} = require('./zotero-local.cjs');
const {consoleUrl, rankEntries, refreshRanks, savePaperRank} = require('./easyscholar.cjs');

const STATUSES = {unread:'待读', reading:'阅读中', finished:'已读'};
const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'];
const activePapers = plugin => [...plugin.store.literature.values()].filter(paper => !paper.deleted);

const itemTypes = {
  journalArticle:'期刊文章','article-journal':'期刊文章',conferencePaper:'会议论文','paper-conference':'会议论文',
  book:'图书',bookSection:'书籍章节',chapter:'书籍章节',thesis:'学位论文',report:'报告',preprint:'预印本',
  webpage:'网页','article-magazine':'杂志文章',magazineArticle:'杂志文章',
  'article-newspaper':'报纸文章',newspaperArticle:'报纸文章',patent:'专利',dataset:'数据集',standard:'标准'
};

function renderLiterature(view,parent,ui) {
  Library.renderLibrary(view,parent,ui,renderPaperDetails);
}

function renderPaperDetails(plugin,parent,paper,metrics,{el,button}) {
  const title = el(parent,'header','td-lit-detail-header');
  el(title,'h3','',paper.title);
  const actions = el(title,'div','td-lit-actions');
  if (paper.pdfPath) button(actions,paper.currentPage>0?'继续阅读':'打开 PDF',
    ()=>plugin.run(()=>plugin.openLiteraturePdf(paper)),'mod-cta');
  button(actions,'编辑文献',()=>plugin.editLiterature(paper));
  button(actions,'复制引用',()=>plugin.showLiteratureCitation(paper),'td-link');
  button(actions,'查分区',()=>plugin.showEasyScholar(paper.id),'td-link');
  const shortcuts = el(parent,'nav','td-lit-detail-shortcuts');
  shortcuts.setAttribute('aria-label','条目详情分区');

  function section(name,open = false) {
    const block = el(parent,'details','td-lit-detail-section');
    block.open = open;
    el(block,'summary','',name);
    button(shortcuts,name,() => {
      block.open = true;
      block.scrollIntoView({block:'nearest'});
      block.querySelector('summary')?.focus({preventScroll:true});
    },'td-link');
    return el(block,'div','td-lit-detail-body');
  }
  function field(list,label,value) {
    if (!value) return;
    el(list,'dt','',label);
    el(list,'dd','',value);
  }

  const metadata = paper.bibliography || {};
  const info = section('信息',true);
  const fields = el(info,'dl','td-lit-fields');
  field(fields,'评分',paper.rating == null ? '未评分' : '★'.repeat(paper.rating)+'☆'.repeat(5-paper.rating)+' '+paper.rating+'/5');
  field(fields,'笔记',paper.memo || '—');
  field(fields,'条目类型',itemTypes[metadata.itemType] || metadata.itemType);
  field(fields,'标题',paper.title);
  const authors = Library.authors(paper);
  for (const name of authors.slice(0,5)) field(fields,'作者',name);
  if (authors.length > 5) {
    el(fields,'dt','','作者');
    const extra = el(fields,'dd','td-lit-more-authors');
    const toggle = button(extra,`显示其余 ${authors.length-5} 位作者`,() => {
      names.hidden = !names.hidden;
      toggle.textContent = names.hidden ? `显示其余 ${authors.length-5} 位作者` : '收起作者';
      toggle.setAttribute('aria-expanded',String(!names.hidden));
    },'td-link');
    toggle.setAttribute('aria-expanded','false');
    const names = el(extra,'ul','td-lit-author-list');
    names.hidden = true;
    for (const name of authors.slice(5)) el(names,'li','',name);
  }
  field(fields,'出版物',paper.publicationTitle);
  const badges = el(info,'div','td-lit-tags td-lit-detail-badges');
  Library.metricBadges(badges,paper,metrics,el);
  field(fields,'日期',Library.date(paper));
  for (const [key,label] of Object.entries(L.bibliographyFields)) {
    if (!['itemType','abstractNote','extra'].includes(key)) field(fields,label,metadata[key]);
  }
  field(fields,'DOI',paper.doi);
  field(fields,'网址',paper.url);
  field(fields,'引用键',paper.citationKey);
  field(fields,'Zotero Key',paper.zoteroKey);
  const url = paper.url || (paper.doi ? 'https://doi.org/'+paper.doi.split('/').map(encodeURIComponent).join('/') : '');
  if (url) {
    const link = el(info,'a','td-lit-original','查看原文 ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  if (metadata.abstractNote) el(section('摘要'),'p','td-lit-prose',metadata.abstractNote);
  if (metadata.extra) el(section('附加信息'),'p','td-lit-prose',metadata.extra);
  const attachments = section('附件与阅读',true);
  const progress = el(attachments,'div','td-lit-progress');
  const percent = L.readingPercent(paper);
  const pages = paper.currentPage == null ? '' : paper.totalPages == null ? `第 ${paper.currentPage} 页` : `${paper.currentPage} / ${paper.totalPages} 页`;
  el(progress,'span','',[STATUSES[paper.status],pages,percent == null ? '' : `${percent}%`].filter(Boolean).join(' · '));
  if (percent != null) {
    const bar = el(progress,'progress','');
    bar.max = 100;
    bar.value = percent;
    bar.setAttribute('aria-label','阅读进度');
  }
  const reading = el(attachments,'div','td-lit-actions');
  if (paper.pdfPath) el(attachments,'small','td-muted',paper.pdfPath.split('/').pop()).title = paper.pdfPath;
  else button(reading,'添加 PDF',()=>plugin.showLiteraturePdfImport(paper));
  button(reading,'阅读与翻译',()=>plugin.showLiteratureReader(paper));
  button(reading,'记录进度',()=>plugin.readingProgress(paper));
  if (paper.notePath) button(reading,'打开笔记',()=>Library.openNote(plugin,paper),'td-link').title = paper.notePath;

  if (paper.collections.length || paper.tags.length) {
    const labels = el(section('分类与标签',true),'div','td-lit-tags');
    for (const label of paper.collections) el(labels,'span','td-lit-tag','分类 · '+label);
    for (const label of paper.tags) el(labels,'span','td-lit-tag','#'+label);
  }
  if (paper.easyScholar) renderRankDetails(section('期刊等级'),paper.easyScholar,el,true);
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
    ['authors','作者（用分号分隔）'], ['publicationTitle','出版物（期刊、会议或书名）'],
    ['doi','DOI'], ['url','原文链接'], ['pdfPath','库内 PDF 路径'], ['notePath','库内笔记路径'],
    ['citationKey','引用键（可选）']
  ].map(([key,label]) => [key,formField(fields,label,'text',paper?.[key])]));
  inputs.publicationDate = formField(fields,'发表日期（年、年-月或年-月-日）','text',Library.date(paper || {}));
  inputs.collections=formField(fields,'文献分类（用分号分隔）','text',paper?.collections.join('；'));
  inputs.tags=formField(fields,'主题标签（用分号分隔）','text',paper?.tags.join('；'));
  inputs.rating = formSelect(fields,'评分',[['','未评分'],...[0,1,2,3,4,5].map(n=>[String(n),n+'/5'])],
    paper?.rating == null ? '' : String(paper.rating));
  inputs.memo = formField(form,'个人笔记','textarea',paper?.memo);
  inputs.memo.rows = 3;
  const metadata = el(form,'details','td-lit-detail-section');
  el(metadata,'summary','','书目信息');
  const metadataGrid = el(metadata,'div','td-lit-form-grid');
  const bibliography = Object.fromEntries(Object.entries(L.bibliographyFields).map(([key,label]) =>
    [key,formField(metadataGrid,label,['abstractNote','extra'].includes(key) ? 'textarea' : 'text',paper?.bibliography?.[key])]));
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
    await savePaper(plugin,paper,{title:title.value,...values(inputs),publicationYear:null,
      bibliography:values(bibliography),metrics:{...entered,fieldSources:sources}},token);
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
    ...original,...normalized, id:original?.id || uid(), createdAt:original?.createdAt || now, updatedAt:now
  },token);
}

async function refreshLocalZotero(plugin,notify) {
  if (plugin.literatureImporting) throw Error('文献导入正在进行，请等待完成。');
  plugin.literatureImporting = true;
  try {
    notify('正在读取本机 Zotero 文献库…');
    const parsed = await plugin.zoteroLocal.read();
    const prepared = prepareLiteratureImport(parsed.records,plugin.store.literature.values(),id=>plugin.store.token('literature',id));
    let added = 0, enriched = 0, failed = 0;
    for (const {original,patch,token} of prepared.changes) {
      if (!original && L.findLiteratureDuplicate(plugin.store.literature.values(),patch)) continue;
      try {
        await savePaper(plugin,original,patch,token);
        if (original) enriched++;
        else added++;
      } catch {
        failed++;
      }
    }
    notify(`Zotero 已读取 ${parsed.records.length} 条 · 新增 ${added} · 补全 ${enriched} · 跳过 ${parsed.skipped} · 失败 ${failed}`);
  } finally {
    plugin.literatureImporting = false;
    plugin.refresh();
  }
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
      const cacheText = cacheFile ? await cacheFile.text() : '';
      if (zoteroFile) {
        const format = zoteroFile.name.toLowerCase().split('.').pop();
        const parsed = L.parseZoteroExport(await zoteroFile.text(),format);
        const matched = cacheFile ? L.applyJournalTagsCache(parsed.records,cacheText) : null;
        const plan = prepareLiteratureImport(matched?.records || parsed.records,plugin.store.literature.values(),
          id=>plugin.store.token('literature',id));
        prepared = plan.changes;
        status.textContent = `新增 ${plan.added} 条 · 补全已有 ${plan.enriched} 条 · 其余重复 ${plan.repeated} 条 · 跳过 ${parsed.skipped} 条`+
          (matched ? ` · 缓存补充 ${matched.enriched} 条` : '');
      } else {
        const current = activePapers(plugin);
        const matched = L.applyJournalTagsCache(current,cacheText);
        prepared = matched.records.flatMap((paper,index) => {
          const original = current[index];
          return JSON.stringify(paper.metrics) === JSON.stringify(original.metrics) ? [] :
            [{original,patch:{metrics:paper.metrics},token:plugin.store.token('literature',original.id)}];
        });
        status.textContent = `缓存匹配 ${matched.matched} 条 · 可补充指标 ${prepared.length} 条`;
      }
      for (const {original,patch} of prepared.slice(0,8)) el(result,'div','',(original ? '补全 · ' : '新增 · ')+(patch.title || original.title));
      apply.disabled = !prepared.length;
    } catch (failure) { error.textContent = failure.message; }
    finally { preview.disabled = source.disabled = cache.disabled = false; }
  });
  const apply = button(actions,'确认导入',async()=>{
    if (!prepared || apply.disabled) return;
    if (plugin.literatureImporting) { error.textContent = '文献导入正在进行，请等待完成。'; return; }
    plugin.literatureImporting = true;
    apply.disabled = preview.disabled = source.disabled = cache.disabled = true;
    error.textContent = '';
    try {
      while (saved < prepared.length) {
        const {original,patch,token} = prepared[saved];
        if (original || !L.findLiteratureDuplicate(plugin.store.literature.values(),patch)) await savePaper(plugin,original,patch,token);
        saved++;
      }
      modal.close();
    } catch (failure) {
      error.textContent = `已处理 ${saved} 条。 ${failure.message}`;
    } finally {
      plugin.literatureImporting = false;
      plugin.refresh();
      apply.disabled = preview.disabled = source.disabled = cache.disabled = false;
    }
  },'mod-cta');
  apply.disabled = true;
}

module.exports = {renderLiterature,showEasyScholar,editLiterature,editProgress,importLiterature,refreshLocalZotero};
