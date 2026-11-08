'use strict';
// Run only against a freshly generated profile and vault.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const {pdfFixture} = require('../tests/fixtures/pdf-fixture.cjs');

const root = path.resolve(__dirname,'..');
const out = path.join(root,'artifacts','native-congrong');
fs.mkdirSync(out,{recursive:true});
const run = fs.mkdtempSync(path.join(out,'run-'));
const profile = path.join(run,'profile');
const vault = path.join(run,'congrong-isolated-vault');
const config = path.join(vault,'.obsidian');
const pluginDir = path.join(config,'plugins','todo-dashboard');
const themeDir = path.join(config,'themes','从容');
const executable = process.env.OBSIDIAN_TEST_EXE;
if (!executable) throw Error('Set OBSIDIAN_TEST_EXE to the local Obsidian executable.');

for (const dir of [profile,pluginDir,themeDir,path.join(vault,'Projects'),path.join(vault,'Research')]) fs.mkdirSync(dir,{recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) fs.copyFileSync(path.join(root,'dist',file),path.join(pluginDir,file));
for (const file of ['manifest.json','theme.css']) fs.copyFileSync(path.join(root,'theme',file),path.join(themeDir,file));
const write = (file,value) => fs.writeFileSync(file,JSON.stringify(value));
write(path.join(profile,'obsidian.json'),{vaults:{'00c0ffee11223344':{path:vault,ts:Date.now(),open:true}}});
write(path.join(config,'appearance.json'),{theme:'moonstone',cssTheme:'从容'});
write(path.join(config,'community-plugins.json'),['todo-dashboard']);
write(path.join(pluginDir,'data.json'),{fileOrders:{
  '/':['Inbox.md','Projects','Research'],
  Projects:['Projects/Today.md','Projects/Brief.md']
}});
for (const file of ['Inbox.md','Projects/Brief.md','Projects/Today.md','Research/Paper.md']) fs.writeFileSync(path.join(vault,file),'# Isolated fixture\n\n[[Projects/Today|Test note link]]');

async function launch() {
  const server = net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port = server.address().port;
  await new Promise(resolve=>server.close(resolve));
  const proc = spawn(executable,['--user-data-dir='+profile,'--remote-debugging-port='+port,'--disable-gpu','--disable-background-networking'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let logs = '';
  proc.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-2400);});
  let launchError;
  proc.once('error',error=>{launchError=error;});
  const url = 'http://127.0.0.1:'+port;
  let browser;
  try {
    for(let attempt=0;attempt<70;attempt++){
      if(launchError)throw launchError;
      if(proc.exitCode!==null)throw Error('Obsidian exited during launch. '+logs);
      const response=await fetch(url+'/json/version',{signal:AbortSignal.timeout(500)}).catch(()=>null);
      if(response?.ok)break;
      if(attempt===69)throw Error('The isolated Obsidian CDP endpoint did not start. '+logs);
      await delay(200);
    }
    browser=await chromium.connectOverCDP(url,{timeout:8000});
    const context=browser.contexts()[0];
    const page=context.pages().find(tab=>tab.url().startsWith('app://obsidian.md/')) || await context.waitForEvent('page',{timeout:10000});
    await page.waitForFunction(()=>window.app?.vault?.getName()==='congrong-isolated-vault',{},{timeout:12000});
    assert.equal(path.resolve(await page.evaluate(()=>app.vault.adapter.getBasePath())),vault);
    page.setDefaultTimeout(9000);
    return {page,close:async()=>{
      const windowClosed=page.waitForEvent('close',{timeout:4500}).catch(()=>{});
      await page.evaluate(()=>{setTimeout(()=>window.close(),0);}).catch(()=>{});
      await windowClosed;
      await browser.close().catch(()=>{});
      await stop(proc);
    }};
  }catch(error){
    await browser?.close();
    await stop(proc);
    throw error;
  }
}

async function stop(proc){
  if(proc.exitCode!==null||proc.signalCode!==null||!proc.pid)return;
  const closed=new Promise(resolve=>proc.once('close',resolve));
  proc.kill();
  await Promise.race([closed,delay(2500)]);
}

async function waitForSavedScheme(scheme){
  const file=path.join(config,'appearance.json');
  for(let attempt=0;attempt<50;attempt++){
    try{if(JSON.parse(fs.readFileSync(file)).theme===scheme)return;}catch{}
    await delay(200);
  }
  throw Error('Obsidian did not persist the selected appearance scheme.');
}

async function enableFixturePlugin(page){
  await page.waitForFunction(()=>window.app?.plugins?.isEnabled()||document.querySelector('.mod-trust-folder'));
  const trust=page.locator('.mod-trust-folder .modal-button-container button').first();
  if(await trust.isVisible()){
    await trust.click();
    await page.evaluate(()=>app.plugins.setEnable(true));
  }
  await page.waitForFunction(()=>window.app?.plugins?.plugins['todo-dashboard']?.ready===true);
}

const renderedRoot = page => page.evaluate(()=>{
  const view=app.workspace.getLeavesOfType('file-explorer')[0].view;
  return view.getSortedFolderItems(app.vault.getRoot()).map(row=>row.file.path);
});
const nested = page => page.evaluate(()=>{
  const view=app.workspace.getLeavesOfType('file-explorer')[0].view;
  return view.getSortedFolderItems(app.vault.getAbstractFileByPath('Projects')).map(row=>row.file.path);
});

async function main(){
  let test;
  try{
    test=await launch();
    const {page}=test;
    page.on('pageerror', error=>console.error('Obsidian renderer:',error.message));
    page.on('console', message=>{if(message.type()==='error'&&message.text().includes('Todo 工作台'))console.error(message.text());});
    await enableFixturePlugin(page);
    await page.getByRole('button',{name:'白天',exact:true}).waitFor();
    await page.bringToFront();
    const shell=page.locator('.td-host');
    const size=await shell.boundingBox();
    assert.ok(size.width>600);
    await page.getByRole('button',{name:'工作台主题',exact:true}).click();
    await page.getByLabel('白天配色',{exact:true}).selectOption('mint');
    await page.getByLabel('夜晚配色',{exact:true}).selectOption('violet-night');
    await page.getByRole('button',{name:'保存主题',exact:true}).click();
    await page.getByRole('heading',{name:'Obsidian 全局主题',exact:true}).waitFor({state:'detached'});
    const sidebar=page.locator('.nav-folder-title[data-path="Projects"]');
    assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).getPropertyValue('--interactive-accent').trim()),'#186951');
    await page.evaluate(()=>app.workspace.openLinkText('Inbox.md','',true,{state:{mode:'preview'}}));
    const link=page.locator('.markdown-preview-view .internal-link').filter({hasText:'Test note link'});
    await link.waitFor();
    assert.equal(await link.evaluate(el=>getComputedStyle(el).color),'rgb(24, 105, 81)');
    await page.evaluate(()=>app.plugins.plugins['todo-dashboard'].open());
    assert.equal(await page.locator('.td-theme-week-day[aria-pressed=true]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 105, 81)');
    assert.equal(await page.locator('.td-clock').evaluate(el=>getComputedStyle(el).color),'rgb(24, 105, 81)');
    const quick=page.locator('[data-widget=today] .td-panel-heading').getByRole('button',{name:'快速记任务'});
    await quick.click();
    const quickInput=page.getByPlaceholder('想记下什么？',{exact:true});
    await quickInput.fill('校对本周计划');
    await page.getByRole('button',{name:'保存任务',exact:true}).evaluate(button=>button.click());
    await page.locator('[data-widget=today]').getByText('校对本周计划',{exact:true}).waitFor();
    await page.screenshot({path:path.join(run,'01-native-warm.png')});

    const fileRow=page.locator('.nav-file-title[data-path="Inbox.md"]');
    const waitForTreeOrder=async fileFirst=>{
      await page.waitForFunction(expected=>{
        const file=document.querySelector('.nav-file-title[data-path="Inbox.md"]');
        const folder=document.querySelector('.nav-folder-title[data-path="Projects"]');
        return file&&folder&&!!(file.compareDocumentPosition(folder)&Node.DOCUMENT_POSITION_FOLLOWING)===expected;
      },fileFirst);
    };
    assert.equal(await page.getByRole('button',{name:'手动排序笔记库根目录'}).count(),0);
    assert.equal(await page.evaluate(()=>Object.hasOwn(app.commands.commands,'todo-dashboard:sort-files')),false);
    const menu=page.locator('.menu:visible');
    for(const row of [fileRow,sidebar]){
      await row.click({button:'right'});
      await menu.waitFor();
      assert.equal(await menu.getByText(/^(上移一位|下移一位|调整同级顺序|排序文件夹内容)$/).count(),0);
      await page.locator('.td-scenery').click({force:true});
      await menu.waitFor({state:'hidden'});
    }
    await waitForTreeOrder(true);
    assert.deepEqual((await renderedRoot(page)).slice(0,2),['Inbox.md','Projects']);
    assert.deepEqual(await nested(page),['Projects/Today.md','Projects/Brief.md']);
    const orderDirectory=path.join(vault,'Todo工作台','文件树排序');
    assert.equal(fs.readdirSync(orderDirectory).filter(name=>name.endsWith('.md')).length,2);

    const dropPoint=async(row,after)=>{
      const box=await row.boundingBox();
      return {x:box.x+box.width/2,y:box.y+box.height*(after ? 0.75 : 0.25)};
    };
    const dragFromTree=async(source,target,after,valid=true)=>{
      const grip=source.locator('.td-explorer-row-grip');
      await target.hover();
      await grip.hover();
      const start=await dropPoint(grip,false);
      const end=await dropPoint(target,after);
      await page.mouse.move(start.x,start.y);
      await page.mouse.down();
      try {
        await page.mouse.move(end.x,end.y,{steps:12});
        if(valid){
          await target.and(page.locator(`[data-td-explorer-drop=${after?'after':'before'}]`)).waitFor({timeout:2500});
        }else{
          await page.locator('[data-td-explorer-drop]').waitFor({state:'detached',timeout:2500});
        }
      } finally {
        await page.mouse.up();
      }
    };
    await dragFromTree(fileRow,sidebar,true);
    await waitForTreeOrder(false);
    assert.deepEqual((await renderedRoot(page)).slice(0,2),['Projects','Inbox.md']);
    await dragFromTree(sidebar,fileRow,true);
    await waitForTreeOrder(true);

    const start=await dropPoint(sidebar.locator('.td-explorer-row-grip'),false);
    const end=await dropPoint(fileRow,false);
    const touch=await page.context().newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    try {
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});
      await fileRow.and(page.locator('[data-td-explorer-drop=before]')).waitFor({timeout:2500});
    } finally {
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await touch.detach();
    }
    await waitForTreeOrder(false);
    assert.deepEqual((await renderedRoot(page)).slice(0,2),['Projects','Inbox.md']);
    await sidebar.click();
    const nestedFile=page.locator('.nav-file-title[data-path="Projects/Brief.md"]');
    await nestedFile.waitFor();
    await dragFromTree(fileRow,nestedFile,true,false);
    assert.deepEqual((await renderedRoot(page)).slice(0,2),['Projects','Inbox.md']);
    assert.equal(fs.existsSync(path.join(vault,'Inbox.md')),true);
    const todayFile=page.locator('.nav-file-title[data-path="Projects/Today.md"]');
    await dragFromTree(nestedFile,todayFile,false);
    await page.waitForFunction(()=>{
      const brief=document.querySelector('.nav-file-title[data-path="Projects/Brief.md"]');
      const today=document.querySelector('.nav-file-title[data-path="Projects/Today.md"]');
      return brief&&today&&(brief.compareDocumentPosition(today)&Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(await page.locator('.td-explorer-sort').count(),0);
    await page.screenshot({path:path.join(run,'02-native-sort.png')});

    await page.evaluate(async () => {
      const directory='Todo工作台/文件树排序';
      const remote={version:1,id:'remote-choice-1',author:'remote-device',kind:'order',folder:'/',
        paths:['Research','Projects','Inbox.md'],sequence:1,context:[],moves:[]};
      const raw='# Todo 工作台文件树排序\n\n'+'\x60\x60\x60json\n'+JSON.stringify(remote,null,2)+'\n'+'\x60\x60\x60\n';
      await app.vault.create(directory+'/order-remote-choice-1.md',raw);
    });
    const conflictButton=page.getByRole('button',{name:'处理排序冲突',exact:true});
    await conflictButton.click();
    const modal=page.locator('.td-modal');
    await modal.getByText('其他设备顺序 1',{exact:true}).waitFor();
    const localOrder=modal.locator('.td-panel').filter({hasText:'本机顺序'});
    await localOrder.getByRole('button',{name:'保留此顺序',exact:true}).click();
    await conflictButton.waitFor({state:'detached'});
    assert.deepEqual((await renderedRoot(page)).slice(0,2),['Projects','Inbox.md']);

    await page.getByRole('button',{name:'文献专区',exact:true}).click();
    await page.getByRole('button',{name:'导入 PDF',exact:true}).click();
    await page.getByLabel('PDF 文件',{exact:true}).setInputFiles({name:'Native reading fixture.pdf',mimeType:'application/pdf',
      buffer:pdfFixture('This first page must remain unselected.','Second page is the reading test source.',' ')});
    await page.getByRole('button',{name:'确认导入 PDF',exact:true}).click();
    await page.getByText('已导入 1 个 PDF · 已存在 0 个',{exact:true}).waitFor();
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    const paperCard=page.locator('.td-lit-paper').filter({hasText:'Native reading fixture'});
    await paperCard.getByRole('button',{name:'阅读与翻译',exact:true}).click();
    await page.getByLabel('PDF 页码',{exact:true}).fill('2');
    await page.getByRole('button',{name:'提取该页',exact:true}).click();
    await page.getByText('已提取第 2 页，共 3 页。',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('原文选段',{exact:true}).inputValue(),'Second page is the reading test source.');
    await page.getByRole('button',{name:'记住这一页',exact:true}).click();
    await page.getByText('已将第 2 页记为续读位置。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'保存阅读摘录',exact:true}).click();
    await page.getByText('阅读摘录已保存。',{exact:true}).waitFor();
    await page.getByLabel('PDF 页码',{exact:true}).fill('3');
    await page.getByRole('button',{name:'提取该页',exact:true}).click();
    await page.getByText('第 3 页为图像页，翻译时会发送该页图像。',{exact:true}).waitFor();
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await paperCard.getByRole('button',{name:'继续阅读',exact:true}).click();
    const pdfText=page.getByText('Second page is the reading test source.',{exact:true});
    await pdfText.waitFor();
    await pdfText.evaluate(node=>{
      const range=document.createRange();range.selectNodeContents(node);
      const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    await page.getByLabel('PDF 阅读与翻译',{exact:true}).click();
    assert.equal(await page.getByLabel('PDF 页码',{exact:true}).inputValue(),'2');
    assert.equal(await page.getByLabel('原文选段',{exact:true}).inputValue(),'Second page is the reading test source.');
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await page.evaluate(()=>app.plugins.plugins['todo-dashboard'].open());

    await page.getByRole('button',{name:'夜晚',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'夜晚',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('theme-dark')),true);
    assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).getPropertyValue('--interactive-accent').trim()),'#d4bfff');
    await waitForSavedScheme('obsidian');
    await page.screenshot({path:path.join(run,'03-native-night.png')});
    await test.close();
    test=null;
    test=await launch();
    await enableFixturePlugin(test.page);
    await test.page.getByRole('button',{name:'夜晚',exact:true}).waitFor();
    assert.equal(await test.page.getByRole('button',{name:'夜晚',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await test.page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim()),'#d4bfff');
    assert.deepEqual((await renderedRoot(test.page)).slice(0,2),['Projects','Inbox.md']);
    assert.deepEqual(await nested(test.page),['Projects/Brief.md','Projects/Today.md']);
    console.log('PASS native Obsidian PDF open, page extraction, selection, resume, and file-tree sync regressions');
    console.log(run);
  }catch(error){
    await test?.page.screenshot({path:path.join(run,'failure.png')}).catch(()=>{});
    console.error('Isolated test evidence:',run);
    throw error;
  }finally{await test?.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
