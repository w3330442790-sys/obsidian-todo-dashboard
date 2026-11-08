'use strict';
const stopped=signal=>{if(signal?.aborted)throw Error('资料读取已取消');};
const PYTHON=String.raw`import sys,json,zipfile,xml.etree.ElementTree as ET
p=sys.argv[1]
if p.lower().endswith('.pdf'):
 from pypdf import PdfReader
 from pypdf.generic import ContentStream
 r=PdfReader(p)
 if r.is_encrypted and not r.decrypt(''): raise ValueError('encrypted PDF')
 if len(sys.argv)>2:
  selected=int(sys.argv[2])
  if not 1<=selected<=len(r.pages):
   print(json.dumps({'pages':len(r.pages),'outOfRange':True}))
   sys.exit(0)
  text=r.pages[selected-1].extract_text() or ''
  print(json.dumps({'text':text,'pages':len(r.pages)},ensure_ascii=False))
  sys.exit(0)
 if len(r.pages)>200: raise ValueError('PDF exceeds 200 pages; split first')
 chunks=[];ocr=[]
 for i,page in enumerate(r.pages):
  text=page.extract_text() or ''
  chunks.append('第'+str(i+1)+'页\n'+text)
  content=page.get_contents()
  graphics=content is not None and any(op in {b'Do',b'BI',b'm',b'l',b'c',b're',b'S',b'f',b'f*',b'B'} for operands,op in ContentStream(content,r).operations)
  if len(text.strip())<25 or graphics: ocr.append(i+1)
 print(json.dumps({'text':'\n\n'.join(chunks),'pages':len(r.pages),'needsOcr':ocr},ensure_ascii=False))
else:
 z=zipfile.ZipFile(p)
 if any(name.startswith('word/media/') for name in z.namelist()): raise ValueError('DOCX includes images; export as PDF first')
 if sum(info.file_size for info in z.infolist())>50000000: raise ValueError('DOCX uncompressed size exceeds limit')
 ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}; chunks=[]
 for name in ['word/document.xml','word/footnotes.xml','word/endnotes.xml']:
  if name not in z.namelist(): continue
  root=ET.fromstring(z.read(name))
  chunks.extend(''.join(n.itertext()) for para in root.findall('.//w:p',ns) for n in [para] if ''.join(para.itertext()).strip())
 print(json.dumps({'text':'\n'.join(chunks),'pages':None,'needsOcr':[]},ensure_ascii=False))
`;
function runtime(){const path=require('node:path'),os=require('node:os'),fs=require('node:fs'),base=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies'),python=path.join(base,'python','python.exe'),poppler=path.join(base,'native','poppler','Library','bin','pdftoppm.exe');return{python:fs.existsSync(python)?python:'python',poppler:fs.existsSync(poppler)?poppler:'pdftoppm'};}
function execute(file,args,signal){stopped(signal);const{execFile}=require('node:child_process');return new Promise((resolve,reject)=>execFile(file,args,{shell:false,windowsHide:true,signal,timeout:120000,maxBuffer:16*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{if(signal?.aborted)return reject(Error('资料读取已取消'));if(error)return reject(Error('文档读取失败：请检查 Python/pypdf 与 Poppler 工具；含图片的 DOCX 请导出 PDF，加密或过大的文件请解密/拆分后重试'));resolve(stdout);}));}
class DocumentReader{
 constructor({extract,render}={}){this.extract=extract||this.extractLocal.bind(this);this.render=render||this.renderLocal.bind(this);}
 async extractLocal(file,{signal}={}){const output=await execute(runtime().python,['-c',PYTHON,file],signal);try{return JSON.parse(output);}catch{throw Error('文档提取返回了无效结果');}}
 async renderLocal(file,pages,{signal}={}){const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),base=os.tmpdir(),dir=await fs.mkdtemp(path.join(base,'todo-course-pdf-'));try{const images=[];for(const page of pages){stopped(signal);const target=path.join(dir,'page-'+page);await execute(runtime().poppler,['-f',String(page),'-l',String(page),'-scale-to','1800','-png','-singlefile',file,target],signal);stopped(signal);const data=await fs.readFile(target+'.png');images.push({page,data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});}return images;}finally{if(path.dirname(dir)===base&&path.basename(dir).startsWith('todo-course-pdf-'))await fs.rm(dir,{recursive:true,force:true});}}
 async read(file,{signal}={}){stopped(signal);const r=await this.extract(file,{signal});stopped(signal);if(typeof r.text!=='string'||!Array.isArray(r.needsOcr)||r.needsOcr.some(n=>!Number.isInteger(n)||n<1||n>r.pages))throw Error('文档提取结构异常');if(r.needsOcr.length>12)throw Error('扫描或含图页面超过 12 页，请拆分后分次上传');const images=r.needsOcr.length?await this.render(file,r.needsOcr,{signal}):[];stopped(signal);if(!r.text.trim()&&!images.length)throw Error('文档无法提取正文，请导出文本或清晰图片');return{...r,images};}
 async readPage(file,page,{signal}={}){
  if(!/\.pdf$/i.test(file)||!Number.isSafeInteger(page)||page<1)throw Error('请选择有效的 PDF 页码');
  const output=await execute(runtime().python,['-c',PYTHON,file,String(page)],signal);
  const result=JSON.parse(output);
  if(result.outOfRange)throw Error(`该 PDF 共 ${result.pages} 页，请检查页码`);
  if(typeof result.text!=='string'||!Number.isSafeInteger(result.pages))throw Error('PDF 页面提取结果无效');
  const text=result.text.trim();
  const images=text.length<25?await this.render(file,[page],{signal}):[];
  stopped(signal);
  return {text,page,pages:result.pages,images};
 }
}
module.exports={DocumentReader};
