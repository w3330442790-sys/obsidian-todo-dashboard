'use strict';

const L = require('./literature.cjs');
const {rankEntries} = require('./easyscholar.cjs');
const {extensionEnabled} = require('./literature-extensions.cjs');

const STATUSES = {unread:'待读',reading:'阅读中',finished:'已读'};
const QUARTILES = ['Q1','Q2','Q3','Q4'];
const columns = [
  ['title','标题'],['authors','创建者'],['date','日期'],['attachments','附件'],['impact','期刊标签']
];
const date = paper => paper.publicationDate || String(paper.publicationYear || '');
const attachmentCount = paper => Number(Boolean(paper.pdfPath)) + Number(Boolean(paper.notePath));
const authors = paper => (paper.authors || '').split(/;\s*/).filter(Boolean);
const creator = paper => {
  const names = authors(paper);
  if (names.length < 2) return names[0] || '';
  return names[0].split(',')[0] + ' 等';
};
const folded = value => String(value ?? '').normalize('NFKC').toLowerCase();

function libraryRows(records,state) {
  const words = folded(state.query).trim().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const paper of records) {
    if (paper.deleted || state.status && state.status !== paper.status ||
        state.collection && !paper.collections.includes(state.collection) ||
        state.tag && !paper.tags.includes(state.tag)) continue;
    const metrics = L.effectiveLiteratureMetrics(paper);
    if (state.quartile && state.quartile !== (metrics.jcrQuartile || 'unknown')) continue;
    if (words.length) {
      const fields = state.scope === 'title' ? [paper.title, paper.authors, paper.publicationTitle, date(paper)] : [
        paper.title,paper.authors,paper.publicationTitle,date(paper),paper.doi,paper.url,paper.citationKey,paper.memo,
        ...Object.values(paper.bibliography || {}),...paper.collections,...paper.tags,
        metrics.jcrQuartile,metrics.casMajor,metrics.casMinor,metrics.impactFactor,
        ...(paper.easyScholar ? rankEntries(paper.easyScholar).map(rank => rank.label+' '+rank.value) : [])
      ];
      const normalized = fields.map(folded);
      if (!words.every(word => normalized.some(field => field.includes(word)))) continue;
    }
    rows.push({paper,metrics});
  }
  function value({paper,metrics}) {
    switch (state.sort) {
      case 'title': return paper.title;
      case 'authors': return creator(paper);
      case 'date': return date(paper);
      case 'impact': return metrics.impactFactor;
      case 'attachments': return attachmentCount(paper);
      default: return paper.updatedAt;
    }
  }
  return rows.sort((a,b) => {
    const left = value(a), right = value(b);
    if (!left && left !== 0) return !right && right !== 0 ? 0 : 1;
    if (!right && right !== 0) return -1;
    const compare = typeof left === 'number' ? left-right : left.localeCompare(right,'zh',{numeric:true});
    return compare * (state.descending === false ? 1 : -1);
  });
}

function metricBadges(parent,paper,metrics,el,compact = false) {
  parent.dataset.quartile = metrics.jcrQuartile || '';
  const factor = metrics.impactFactor;
  const tags = [
    ['impactFactor',factor == null ? '' : 'IF '+(Number.isInteger(factor) ? factor.toFixed(1) : factor)],
    ['jcrQuartile',metrics.jcrQuartile && 'JCR '+metrics.jcrQuartile],
    ['casMajor',metrics.casMajor && (compact ? '中科院 ' : '中科院大类 ')+metrics.casMajor],
    ['casMinor',!compact && metrics.casMinor && '中科院小类 '+metrics.casMinor]
  ];
  for (const [key,label] of tags) {
    if (!label) continue;
    const badge = el(parent,'span','td-lit-tag',label);
    badge.dataset.metric = key === 'jcrQuartile' ? metrics.jcrQuartile : key;
    const online = paper.easyScholar && (paper.metrics[key] == null || paper.metrics[key] === '');
    const source = online ? 'EasyScholar · 查询于 '+new Date(paper.easyScholar.checkedAt).toLocaleDateString('zh-CN') :
      (metrics.fieldSources?.[key] || [metrics.metricsYear,metrics.metricsSource].filter(Boolean).join(' · '));
    badge.title = [label,source].filter(Boolean).join(' · ');
  }
  if (!parent.childElementCount && !compact) el(parent,'span','td-muted','暂无期刊指标');
}

function openNote(plugin,paper) {
  return plugin.run(async () => {
    const file = plugin.app.vault.getAbstractFileByPath(paper.notePath);
    if (!file?.extension) throw Error('库内笔记未找到：'+paper.notePath);
    await plugin.app.workspace.openLinkText(file.path,'',true);
  });
}

function renderLibrary(view,parent,ui,renderDetails) {
  const {el,button,heading,select,empty} = ui;
  const plugin = view.plugin;
  heading(parent,'','文献专区');
  const root = el(parent,'section','td-lit-library');
  const stacked = () => root.clientWidth <= 880;
  const state = view.state.literature ??= {
    query:'',scope:'all',status:'',quartile:'',collection:'',tag:'',sort:'recent',descending:true,
    limit:80,showNav:!stacked(),showDetail:!stacked(),expanded:new Set()
  };
  const toolbar = el(root,'div','td-lit-library-tools');
  const actions = el(toolbar,'div','td-lit-library-actions');
  const navToggle = button(actions,'分类',() => {
    state.showNav = !state.showNav;
    syncPanes();
  },'td-lit-toggle','☰');
  button(actions,'添加文献',() => plugin.editLiterature(),'','＋');
  button(actions,'导入 PDF',() => plugin.showLiteraturePdfImport(),'','▧');
  button(actions,'导入 Zotero',() => plugin.importLiterature(),'','↥');
  if (plugin.zoteroLocal && extensionEnabled(plugin.store.settings,'zoteroLocal')) {
    button(actions,'从 Zotero 刷新',() => plugin.refreshLocalZotero(),'','↻');
  }
  if (extensionEnabled(plugin.store.settings,'greenFrog')) {
    button(actions,'EasyScholar',() => plugin.showEasyScholar());
    button(actions,'更新本列表分区',() => plugin.showEasyScholar(undefined,
      libraryRows(papers,state).map(({paper})=>paper.id)));
  }
  button(actions,'文献扩展',()=>plugin.showLiteratureExtensions());
  const detailToggle = button(actions,'条目详情',() => {
    state.showDetail = !state.showDetail;
    syncPanes();
    if (state.showDetail && stacked()) details.scrollIntoView({block:'start'});
  },'td-lit-toggle','▤');

  const quickFind = el(toolbar,'div','td-lit-quick-find');
  const scope = select(quickFind,[['all','所有字段和标签'],['title','标题、作者、刊名和日期']],state.scope,
    value => setFilter('scope',value));
  scope.setAttribute('aria-label','文献搜索范围');
  const search = el(quickFind,'input','td-input');
  search.type = 'search';
  search.placeholder = '搜索文献';
  search.value = state.query;
  search.setAttribute('aria-label','搜索文献');
  search.addEventListener('input',() => setFilter('query',search.value));

  const workspace = el(root,'div','td-lit-workspace');
  const nav = el(workspace,'aside','td-lit-nav');
  nav.setAttribute('aria-label','文献分类与筛选');
  const middle = el(workspace,'div','td-lit-middle');
  const scroll = el(middle,'div','td-lit-table-scroll');
  const table = el(scroll,'table','td-lit-table');
  table.setAttribute('aria-label','文献条目');
  const head = el(el(table,'thead',''),'tr','');
  const headers = new Map();
  for (const [key,label] of columns) {
    const cell = el(head,'th','td-lit-col-'+key);
    cell.scope = 'col';
    const sort = button(cell,label,() => {
      state.descending = state.sort === key ? !state.descending : !['title','authors'].includes(key);
      setFilter('sort',key);
    },'td-lit-sort');
    headers.set(key,{cell,sort,label});
  }
  const rows = el(table,'tbody','');
  const status = el(middle,'div','td-lit-library-status');
  status.setAttribute('role','status');
  const details = el(workspace,'aside','td-lit-details');
  details.setAttribute('aria-label','条目详情');
  const papers = [...plugin.store.literature.values()].filter(paper => !paper.deleted);
  const visible = new Map();

  function syncPanes() {
    nav.hidden = !state.showNav;
    details.hidden = !state.showDetail;
    workspace.classList.toggle('has-nav',state.showNav);
    workspace.classList.toggle('has-detail',state.showDetail);
    navToggle.setAttribute('aria-expanded',String(state.showNav));
    detailToggle.setAttribute('aria-expanded',String(state.showDetail));
  }

  function setFilter(key,value) {
    state[key] = value;
    state.limit = 80;
    scroll.scrollTop = 0;
    if (key === 'collection') showNav();
    show();
  }

  function showNav() {
    nav.replaceChildren();
    el(nav,'h3','','分类');
    const counts = new Map();
    for (const paper of papers) for (const name of paper.collections) counts.set(name,(counts.get(name) || 0)+1);
    if (state.collection && !counts.has(state.collection)) state.collection = '';
    for (const [key,label] of [['','我的文献库'],...[...counts.keys()].sort((a,b)=>a.localeCompare(b,'zh')).map(name=>[name,name])]) {
      const entry = button(nav,'',() => {
        setFilter('collection',key);
        nav.querySelector('.is-active')?.focus();
      },'td-lit-nav-item'+(state.collection === key ? ' is-active' : ''));
      entry.setAttribute('aria-pressed',String(state.collection === key));
      el(entry,'span','',label);
      el(entry,'small','td-muted',String(key ? counts.get(key) : papers.length));
    }
    el(nav,'h3','','筛选');
    const tags = [...new Set(papers.flatMap(paper=>paper.tags))].sort((a,b)=>a.localeCompare(b,'zh'));
    if (state.tag && !tags.includes(state.tag)) state.tag = '';
    for (const [key,label,options] of [
      ['tag','标签',[['','全部标签'],...tags.map(tag=>[tag,tag])]],
      ['status','阅读状态',[['','全部阅读状态'],...Object.entries(STATUSES)]],
      ['quartile','JCR 分区',[['','全部 JCR 分区'],...QUARTILES.map(q=>[q,q]),['unknown','未记录分区']]]
    ]) {
      const wrap = el(nav,'label','td-lit-nav-filter');
      el(wrap,'span','td-muted',label);
      select(wrap,options,state[key],value=>setFilter(key,value));
    }
  }

  function showDetails() {
    details.replaceChildren();
    const selected = visible.get(state.selected)?.record;
    if (!selected) {
      empty(details,'选择一条文献以查看详情。');
      return;
    }
    if (stacked()) button(details,'返回列表',() => {
      state.showDetail = false;
      syncPanes();
      visible.get(state.selected)?.title.focus();
    },'td-lit-back');
    renderDetails(plugin,details,selected.paper,selected.metrics,ui);
  }

  function selectRow(id,openDetail = false) {
    state.selected = id;
    for (const [key,{row,title}] of visible) {
      row.classList.toggle('is-selected',key === id);
      title.setAttribute('aria-current',key === id ? 'true' : 'false');
    }
    if (openDetail) state.showDetail = true;
    syncPanes();
    showDetails();
    if (openDetail && stacked()) details.scrollIntoView({block:'start'});
  }

  function openPaper(paper) {
    if (paper.pdfPath) plugin.run(() => plugin.openLiteraturePdf(paper));
    else plugin.editLiterature(paper);
  }

  function renderRow(record,index,visibleRows) {
    const {paper,metrics} = record;
    const row = el(rows,'tr','td-lit-item-row');
    const cell = el(el(row,'td',''),'div','td-lit-title-cell');
    if (attachmentCount(paper)) {
      const expanded = state.expanded.has(paper.id);
      const toggle = button(cell,expanded ? '▾' : '▸',event => {
        event.stopPropagation();
        if (expanded) state.expanded.delete(paper.id);
        else state.expanded.add(paper.id);
        show();
        visible.get(paper.id)?.row.querySelector('.td-lit-expand')?.focus();
      },'td-lit-expand');
      toggle.setAttribute('aria-expanded',String(expanded));
      toggle.setAttribute('aria-label',(expanded?'收起':'展开')+'附件 · '+paper.title);
    } else el(cell,'span','td-lit-expand-space');
    el(cell,'span','td-lit-item-icon','▤').setAttribute('aria-hidden','true');
    const title = button(cell,paper.title,() => selectRow(paper.id,true),'td-lit-title');
    title.title = paper.title;
    row.addEventListener('click',event => {
      if (!event.target.closest('button')) selectRow(paper.id,true);
    });
    row.addEventListener('dblclick',event => {
      if (!event.target.closest('.td-lit-expand')) openPaper(paper);
    });
    title.addEventListener('keydown',event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleRows.length-1 :
        Math.max(0,Math.min(visibleRows.length-1,index+(event.key === 'ArrowDown' ? 1 : -1)));
      const id = visibleRows[next].paper.id;
      selectRow(id);
      visible.get(id)?.title.focus();
    });
    const author = el(row,'td','td-lit-creator',creator(paper) || '—');
    author.title = paper.authors || '';
    el(row,'td','td-lit-date',date(paper) || '—');
    const attachment = el(row,'td','td-lit-attachment');
    if (paper.pdfPath) button(attachment,'PDF',event => {
      event.stopPropagation();
      openPaper(paper);
    },'td-lit-attachment-button').setAttribute('aria-label','打开 PDF · '+paper.title);
    else if (paper.notePath) button(attachment,'笔记',event => {
      event.stopPropagation();
      openNote(plugin,paper);
    },'td-lit-attachment-button');
    const badges = el(el(row,'td','td-lit-metrics-cell'),'div','td-lit-row-badges');
    metricBadges(badges,paper,metrics,el,true);
    visible.set(paper.id,{row,title,record});
    if (state.expanded.has(paper.id) && attachmentCount(paper)) {
      const children = el(el(rows,'tr','td-lit-child-row'),'td','');
      children.colSpan = columns.length;
      if (paper.pdfPath) button(children,'PDF · '+paper.pdfPath.split('/').pop(),()=>openPaper(paper),'td-link');
      if (paper.notePath) button(children,'笔记 · '+paper.notePath.split('/').pop(),()=>openNote(plugin,paper),'td-link');
    }
  }

  function show() {
    visible.clear();
    rows.replaceChildren();
    status.replaceChildren();
    for (const [key,{cell,sort,label}] of headers) {
      const active = state.sort === key;
      cell.setAttribute('aria-sort',active ? (state.descending ? 'descending' : 'ascending') : 'none');
      sort.textContent = active ? label+(state.descending ? ' ▾' : ' ▴') : label;
    }
    const filtered = libraryRows(papers,state);
    const displayed = filtered.slice(0,state.limit);
    displayed.forEach((record,index)=>renderRow(record,index,displayed));
    if (!displayed.length) {
      const message = el(el(rows,'tr',''),'td','');
      message.colSpan = columns.length;
      empty(message,papers.length ? '没有符合筛选条件的文献。' : '添加文献，或导入 Zotero 导出文件。');
    }
    el(status,'span','td-muted',`${filtered.length} 条文献 · 共 ${papers.length} 条`);
    if (filtered.length > state.limit) button(status,'显示更多',() => { state.limit += 80; show(); });
    selectRow(visible.has(state.selected) ? state.selected : displayed[0]?.paper.id);
  }

  showNav();
  show();
}

module.exports = {renderLibrary,libraryRows,metricBadges,date,authors,openNote};
