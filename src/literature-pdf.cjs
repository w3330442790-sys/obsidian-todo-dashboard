'use strict';

const {hash} = require('./course.cjs');
const {DocumentReader} = require('./documents.cjs');
const MAX_PDF_BYTES = 50 * 1024 * 1024;

async function readLocalPdf(value) {
  const fs = require('node:fs/promises');
  const {O_RDONLY,O_NONBLOCK} = require('node:fs').constants;
  const path = require('node:path');
  const {fileURLToPath} = require('node:url');
  let requested;
  try {
    if (!/^file:\/\/\//i.test(value)) throw Error();
    const url = new URL(value);
    if (url.hostname || url.search || url.hash) throw Error();
    requested = fileURLToPath(url);
    if (!path.isAbsolute(requested) || /^[\\/]{2}/.test(requested) || path.extname(requested).toLowerCase() !== '.pdf') throw Error();
  } catch {
    throw Error('Zotero 未提供有效的本机 PDF 文件。');
  }
  let handle;
  try {
    const resolved = await fs.realpath(requested);
    if (/^[\\/]{2}/.test(resolved)) throw Error('Zotero 附件不是本机 PDF 文件。');
    handle = await fs.open(resolved,O_RDONLY|(O_NONBLOCK || 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error('Zotero 附件不是本机 PDF 文件。');
    if (stat.size > MAX_PDF_BYTES) throw Error('Zotero 附件超过 50 MB。');
    const buffer = new Uint8Array(stat.size+1);
    let read = 0;
    while (read < buffer.length) {
      const {bytesRead} = await handle.read(buffer,read,buffer.length-read,read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    if (read !== stat.size) throw Error('Zotero 附件正在变更，请稍后重试。');
    return {name:path.basename(requested),size:read,arrayBuffer:async()=>buffer.buffer.slice(0,read)};
  } catch (failure) {
    if (failure.code) throw Error('无法读取 Zotero PDF。请确认附件已下载到本机，并能在 Zotero 中打开。');
    throw failure;
  } finally {
    await handle?.close().catch(()=>{});
  }
}

async function importZoteroPdf(plugin,paper,attachmentKey,{signal,readFile = readLocalPdf} = {}) {
  function currentPaper() {
    const current = plugin.store.literature.get(paper.id);
    if (!current || current.deleted) throw Error('文献记录已移出专区。');
    if (current.zoteroKey !== paper.zoteroKey || current.title !== paper.title || current.doi !== paper.doi) {
      throw Error('文献书目信息已变更，请重新打开附件。');
    }
    if (current.pdfPath) throw Error('这篇文献已经关联 PDF。');
    return current;
  }
  const importing = plugin.zoteroPdfImports ??= new Set();
  if (importing.has(paper.id)) throw Error('此文献的 PDF 正在导入。');
  importing.add(paper.id);
  try {
    signal?.throwIfAborted();
    currentPaper();
    const url = await plugin.zoteroLocal.pdfUrl(paper,attachmentKey);
    signal?.throwIfAborted();
    const file = await readFile(url);
    signal?.throwIfAborted();
    const current = currentPaper();
    return await importLiteraturePdf(plugin,file,{paper:current,token:plugin.store.token('literature',current.id),signal,isolated:true});
  } finally {
    importing.delete(paper.id);
  }
}

async function importLiteraturePdf(plugin, file, {paper, token, signal, isolated = false} = {}) {
  if (!file || !/\.pdf$/i.test(file.name) || file.size > MAX_PDF_BYTES) throw Error('请选择 50 MB 以内的 PDF 文件');
  const data = await file.arrayBuffer();
  const header = new TextDecoder().decode(data.slice(0,1024));
  if (data.byteLength > MAX_PDF_BYTES || !/%PDF-\d\.\d/.test(header)) throw Error('文件不是可识别的 PDF');

  const {store,app} = plugin;
  const vault = app.vault;
  const digest = await hash(data);
  const baseFolder = store.root + '/literature-pdfs';
  const zoteroFolder = baseFolder+'/_zotero-items';
  if (isolated && !/^[\w-]+$/.test(paper?.id || '')) throw Error('文献记录 ID 无效');
  const folder = isolated ? zoteroFolder+'/'+paper.id : baseFolder;
  const suffix = '-'+digest+'.pdf';
  const name = file.name.replace(/\.pdf$/i,'').trim();
  const safeName = Array.from(name.replace(/[\\/:*?"<>|\[\]#\x00-\x1f]/g,'_').replace(/^\.+|[. ]+$/g,'')).slice(0,70).join('')||'文献';
  const match = vault.getFiles().find(candidate=>candidate.path.startsWith(folder+'/') &&
    (isolated || !candidate.path.startsWith(zoteroFolder+'/')) && candidate.path.endsWith(suffix));
  const path = match?.path || folder+'/'+safeName+suffix;
  if (paper?.pdfPath && paper.pdfPath !== path) throw Error('这篇文献已有 PDF，请在编辑文献中管理附件路径');
  signal?.throwIfAborted();
  if (isolated) {
    await store.ensureFolder(baseFolder);
    await store.ensureFolder(zoteroFolder);
  }
  await store.ensureFolder(folder);
  signal?.throwIfAborted();
  let existing = vault.getAbstractFileByPath(path);
  let created;
  try {
    if (!existing) {
      try { created = await vault.createBinary(path,data); }
      catch (error) {
        existing = vault.getAbstractFileByPath(path);
        if (!existing) throw error;
      }
    }
    if (existing && (existing.extension !== 'pdf' || vault.readBinary && await hash(await vault.readBinary(existing)) !== digest)) {
      throw Error('同名 PDF 已有不同内容，附件未覆盖');
    }
    const duplicate = !paper && [...store.literature.values()].find(record => !record.deleted && record.pdfPath === path);
    if (duplicate) return {paper:duplicate,duplicate:true};
    if (paper?.pdfPath === path) return {paper,duplicate:true};
    signal?.throwIfAborted();
    const now = new Date().toISOString();
    const saved = await store.saveLiterature({
      ...(paper || {id:'pdf-'+digest,title:name||'PDF 文献',createdAt:now}),
      pdfPath:path, updatedAt:now, deleted:false
    },token);
    return {paper:saved,duplicate:false};
  } catch (error) {
    if (isolated && created && vault.delete && vault.readBinary) {
      await removeUnusedPdf(vault,store,path,created,digest).catch(()=>{});
    }
    throw error;
  }
}

async function removeUnusedPdf(vault,store,path,created,digest) {
  if (vault.getAbstractFileByPath(path) !== created || await hash(await vault.readBinary(created)) !== digest) return;
  if (vault.getAbstractFileByPath(path) === created && ![...store.literature.values()].some(record=>record.pdfPath === path)) {
    await vault.delete(created);
  }
}

function renderZoteroPdfDialog(plugin,root,modal,paper,{el,button}) {
  const controller = new AbortController();
  const {signal} = controller;
  el(root,'p','',paper.title);
  const status = el(root,'p','td-muted','正在读取 Zotero 附件…');
  status.setAttribute('role','status');
  const choices = el(root,'div','td-lit-pdf-choices');
  const buttons = [];
  let busy = false;
  async function choose(key) {
    if (busy || signal.aborted) return;
    busy = true;
    for (const control of buttons) control.disabled = true;
    status.textContent = '正在复制 PDF 到笔记库…';
    try {
      const result = await importZoteroPdf(plugin,paper,key,{signal});
      plugin.refresh();
      if (signal.aborted) return;
      modal.close();
      await plugin.run(()=>plugin.openLiteraturePdf(result.paper));
    } catch (error) {
      if (!signal.aborted) status.textContent = error.message;
    } finally {
      busy = false;
      for (const control of buttons) control.disabled = false;
    }
  }
  button(root,'关闭',()=>modal.close(),'td-link');
  plugin.zoteroLocal.listPdfs(paper).then(attachments=>{
    if (signal.aborted) return;
    status.textContent = attachments.length ? '请选择要关联的 PDF。' : '此 Zotero 条目没有可用的本机 PDF 附件。';
    for (const attachment of attachments) {
      const label = attachment.filename && attachment.filename !== attachment.title
        ? attachment.title+' · '+attachment.filename : attachment.title;
      buttons.push(button(choices,label,()=>choose(attachment.key)));
    }
    if (attachments.length === 1) return choose(attachments[0].key);
  }).catch(error=>{
    if (!signal.aborted) status.textContent = error.message;
  });
  return ()=>controller.abort();
}

function readLiteraturePdfPage(plugin,paper,page,{signal}={}) {
  const vault=plugin.app.vault;
  const base=vault.adapter?.getBasePath?.();
  if (!plugin.assistant?.desktop || !base) throw Error('提取 PDF 页需在 Windows 本机使用');
  const file=vault.getAbstractFileByPath(paper.pdfPath);
  if(file?.extension?.toLowerCase()!=='pdf') throw Error('库内 PDF 未找到，请先同步或关联附件');
  return new DocumentReader().readPage(base+'/'+file.path,page,{signal});
}

module.exports={importLiteraturePdf,readLiteraturePdfPage,readLocalPdf,importZoteroPdf,renderZoteroPdfDialog};
