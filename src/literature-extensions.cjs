'use strict';

const greenFrogRepository = 'https://github.com/redleafnew/zotero-updateifse';
const adapters = {
  greenFrog:{name:'Green Frog · 期刊指标',description:'使用 EasyScholar 更新单篇或当前筛选列表的期刊指标。',source:greenFrogRepository},
  zoteroLocal:{name:'Zotero 本机连接',description:'在桌面端读取 Zotero 个人库与 PDF 附件。'},
  translation:{name:'文献翻译',description:'调用本机 Codex 翻译原文选段或 PDF 单页。'}
};

function canonicalRepository(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  const match = /^https:\/\/github\.com\/([a-z0-9-]+)\/([a-z0-9_.-]+?)\/?$/i.exec(input);
  const repo = match?.[2].replace(/\.git$/i,'');
  if (!repo || repo === '.' || repo === '..') throw Error('请输入 GitHub 仓库主页地址，例如 https://github.com/owner/repo。');
  return 'https://github.com/'+match[1].toLowerCase()+'/'+repo.toLowerCase();
}

function normalizeExtensions(input = {}) {
  return {
    enabled:Object.fromEntries(Object.keys(adapters).map(key=>[key,input.enabled?.[key] !== false])),
    repositories:[...new Set((input.repositories || []).map(canonicalRepository))].filter(url=>url !== greenFrogRepository)
  };
}

function extensionEnabled(settings,key) {
  return Object.hasOwn(adapters,key) && settings?.literatureExtensions?.enabled?.[key] !== false;
}

function renderExtensions(plugin,root,modal,{el,button,formField}) {
  const initial = plugin.store.settings.literatureExtensions || {};
  const token = plugin.store.token('settings','settings');
  const controls = {};
  el(root,'p','td-muted','开关只作用于已经适配的功能。新增仓库地址会进入待适配清单。');
  for (const [id,adapter] of Object.entries(adapters)) {
    const row = el(root,'div','td-lit-extension');
    const label = el(row,'label','td-lit-extension-toggle');
    const check = el(label,'input','td-check');
    check.type = 'checkbox';
    el(label,'span','',adapter.name);
    check.checked = extensionEnabled(plugin.store.settings,id);
    controls[id] = check;
    el(row,'p','td-muted',adapter.description);
    if (adapter.source) {
      const link = el(row,'a','','GitHub 源项目 ↗');
      link.href = adapter.source;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
  const entries = Array.isArray(initial.repositories) ? initial.repositories.filter(url=>typeof url==='string') : [];
  const repositories = formField(root,'待适配 GitHub 仓库（每行一个）','textarea',entries.join('\n'));
  repositories.rows = 4;
  const error = el(root,'p','td-error');
  error.setAttribute('role','alert');
  const actions = el(root,'div','td-modal-actions');
  button(actions,'取消',()=>modal.close());
  const save = button(actions,'保存扩展设置',async()=>{
    save.disabled = true;
    error.textContent = '';
    try {
      const settings = normalizeExtensions({
        enabled:Object.fromEntries(Object.entries(controls).map(([id,control])=>[id,control.checked])),
        repositories:repositories.value.split(/\r?\n/).map(url=>url.trim()).filter(Boolean)
      });
      await plugin.updateSettings({literatureExtensions:settings},token);
      modal.close();
    } catch (failure) {
      error.textContent = failure.message;
      save.disabled = false;
    }
  },'mod-cta');
}

module.exports = {canonicalRepository,extensionEnabled,normalizeExtensions,renderExtensions};
