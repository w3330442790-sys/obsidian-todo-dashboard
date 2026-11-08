'use strict';

const {hash} = require('./course.cjs');
const {DocumentReader} = require('./documents.cjs');
const MAX_PDF_BYTES = 50 * 1024 * 1024;

async function importLiteraturePdf(plugin, file, {paper, token} = {}) {
  if (!file || !/\.pdf$/i.test(file.name) || file.size > MAX_PDF_BYTES) throw Error('请选择 50 MB 以内的 PDF 文件');
  const data = await file.arrayBuffer();
  const header = new TextDecoder().decode(data.slice(0,1024));
  if (data.byteLength > MAX_PDF_BYTES || !/%PDF-\d\.\d/.test(header)) throw Error('文件不是可识别的 PDF');

  const {store,app} = plugin;
  const vault = app.vault;
  const digest = await hash(data);
  const folder = store.root + '/literature-pdfs';
  const suffix = '-'+digest+'.pdf';
  const name = file.name.replace(/\.pdf$/i,'').trim();
  const safeName = Array.from(name.replace(/[\\/:*?"<>|\[\]#\x00-\x1f]/g,'_').replace(/^\.+|[. ]+$/g,'')).slice(0,70).join('')||'文献';
  const match = vault.getFiles().find(candidate=>candidate.path.startsWith(folder+'/') && candidate.path.endsWith(suffix));
  const path = match?.path || folder+'/'+safeName+suffix;
  if (paper?.pdfPath && paper.pdfPath !== path) throw Error('这篇文献已有 PDF，请在编辑文献中管理附件路径');
  await store.ensureFolder(folder);
  let existing = vault.getAbstractFileByPath(path);
  if (!existing) {
    try { await vault.createBinary(path,data); }
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
  const now = new Date().toISOString();
  const saved = await store.saveLiterature({
    ...(paper || {id:'pdf-'+digest,title:name||'PDF 文献',createdAt:now}),
    pdfPath:path, updatedAt:now, deleted:false
  },token);
  return {paper:saved,duplicate:false};
}

function readLiteraturePdfPage(plugin,paper,page,{signal}={}) {
  const vault=plugin.app.vault;
  const base=vault.adapter?.getBasePath?.();
  if (!plugin.assistant?.desktop || !base) throw Error('提取 PDF 页需在 Windows 本机使用');
  const file=vault.getAbstractFileByPath(paper.pdfPath);
  if(file?.extension?.toLowerCase()!=='pdf') throw Error('库内 PDF 未找到，请先同步或关联附件');
  return new DocumentReader().readPage(base+'/'+file.path,page,{signal});
}

module.exports={importLiteraturePdf,readLiteraturePdfPage};
