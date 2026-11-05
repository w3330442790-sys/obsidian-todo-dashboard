// Synthetic tasks in the isolated preview only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts','calendar');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,data)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(data);});});
const passed=[],errors=[];async function check(name,fn){try{await fn();passed.push(name);console.log('PASS '+name);}catch(e){errors.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message);}}
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:420,height:900}});page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/tests/preview.html`);await page.waitForFunction(()=>window.ready);
 await page.evaluate(async()=>{for(const t of [...p.store.tasks.values()])await p.saveTask({...t,deleted:true});for(let i=0;i<12;i++)await p.saveTask({id:'dense-'+i,subtasks:[],repeat:'none',title:i===0?'中医内科学见习与病例讨论：完成本周整理和文献阅读':'任务 '+String(i).padStart(2,'0'),date:'2026-11-04',status:i===11?'done':'open',difficulty:'normal'});await p.saveTask({id:'range',title:'跨日范围任务',date:'2026-11-05',endDate:'2026-11-07',status:'open'});await new Promise(r=>setTimeout(r,700));leaf.view.state.month='2026-11';leaf.view.state.selectedDate='2026-11-04';leaf.view.go('calendar');});
 const day=()=>page.locator('.td-day').filter({has:page.getByRole('button',{name:'2026-11-04 查看日程',exact:true})});
 await check('completed tasks are shown by default',async()=>assert.equal(await page.getByLabel('显示已完成',{exact:true}).isChecked(),true));
 await check('all twelve tasks render in the date cell',async()=>assert.equal(await day().locator('.td-calendar-task').count(),12));
 await check('range task appears on all three dates',async()=>assert.equal(await page.locator('.td-calendar .td-calendar-task').filter({hasText:'跨日范围任务'}).count(),3));
 for(const width of [360,420,768,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await check(width+'px calendar has no page overflow and compact date/task buttons',async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await day().locator('.td-day-number').evaluate(e=>e.getBoundingClientRect().height)<=28);assert.ok(await day().locator('.td-calendar-task').nth(1).evaluate(e=>e.getBoundingClientRect().height)<=24);});
  await check(width+'px long title wraps without ellipsis and all tasks scroll into reach',async()=>{assert.equal(await day().locator('.td-calendar-task').filter({hasText:'中医内科学'}).evaluate(e=>getComputedStyle(e).whiteSpace),'normal');const list=day().locator('.td-day-tasks');assert.equal(await list.evaluate(e=>e.scrollHeight>e.clientHeight),true);await day().locator('.td-calendar-task').last().scrollIntoViewIfNeeded();assert.equal(await day().locator('.td-calendar-task').last().isVisible(),true);await list.evaluate(e=>e.scrollTop=0);});
  await page.screenshot({path:path.join(output,'calendar-'+width+'.png'),fullPage:true});
 }
 await check('last completed task can be edited from the calendar',async()=>{await day().locator('.td-calendar-task').last().click();await page.getByLabel('任务名称',{exact:true}).waitFor();assert.equal(await page.getByLabel('任务名称',{exact:true}).inputValue(),'任务 11');await page.getByRole('button',{name:'取消',exact:true}).click();});
 await check('completed filter can hide and restore completed tasks',async()=>{await page.getByLabel('显示已完成',{exact:true}).uncheck();assert.equal(await day().locator('.td-calendar-task').count(),11);await page.getByLabel('显示已完成',{exact:true}).check();assert.equal(await day().locator('.td-calendar-task.is-done').count(),1);});
 await page.addStyleTag({content:'.td-host button{font-size:16px;padding:12px 16px;min-height:44px;height:44px}'});
 await page.setViewportSize({width:360,height:900});
 await check('calendar sizing withstands large generic theme buttons',async()=>{assert.ok(await day().locator('.td-day-number').evaluate(e=>e.getBoundingClientRect().height)<=28);assert.ok(await day().locator('.td-calendar-task').nth(1).evaluate(e=>e.getBoundingClientRect().height)<=24);});
 await page.evaluate(()=>{p.store.settings.gallery.fixedFile=p.galleryFolder()+'/01-moraine-lake.jpg';p.galleryCredits=new Map([['01-moraine-lake.jpg',{attribution:'Simo Räsänen',license:'CC BY-SA 4.0'}]]);leaf.view.go('home');});
 for(const width of [360,420,768]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await check(width+'px scenery controls stay small and clear of the caption',async()=>{for(const selector of ['.td-scenery-credit','.td-scenery-settings']){const b=page.locator(selector);assert.ok(await b.evaluate(e=>e.getBoundingClientRect().height)<=28);assert.ok(await b.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))<=11,selector+' font '+await b.evaluate(e=>getComputedStyle(e).fontSize));}const credit=await page.locator('.td-scenery-credit').boundingBox(),caption=await page.locator('.td-scenery-caption').boundingBox();assert.ok(caption.y+caption.height<=credit.y);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);});await page.screenshot({path:path.join(output,'home-'+width+'.png'),fullPage:true});}
 await check('credit opens the existing license source',async()=>{await page.evaluate(()=>p.app.workspace.openLinkText=(...args)=>window.creditLink=args);await page.locator('.td-scenery-credit').click();assert.ok(await page.evaluate(()=>window.creditLink[0].endsWith('/SOURCE_LICENSES.md')));});
 await check('today quadrant uses the local date and includes ranges covering today',async()=>{
  await page.evaluate(async()=>{
   const offset=days=>{const date=new Date();date.setDate(date.getDate()+days);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);};
   for(const [id,date,endDate,quadrant] of [
    ['today',offset(0),'','today'],['range',offset(-2),offset(0),'today'],
    ['late',offset(-1),'','today'],['future',offset(1),'','today'],
    ['undated','','','today'],['waiting',offset(-1),'','waiting']
   ])await p.saveTask({id:'quadrant-'+id,title:id,date,endDate,quadrant,status:'open'});
   leaf.view.go('quadrants');
  });
  assert.deepEqual(await page.locator('.td-q-today .td-task-title').allTextContents(),['range','today']);
  assert.deepEqual(await page.locator('.td-q-waiting .td-task-title').allTextContents(),['waiting']);
  await page.getByRole('button',{name:'新建今日处理任务'}).click();
  assert.equal(await page.locator('.td-modal input[type=date]').first().inputValue(),await page.evaluate(()=>p.lastDay));
  await page.getByRole('button',{name:'取消',exact:true}).click();
 });
 await check('bundled gallery loads and rotates through 24 distinct photos without a network request',async()=>{
  await page.context().setOffline(true);
  await page.evaluate(()=>{p.galleryFiles=()=>[];leaf.view.go('home');});
  const image=page.locator('.td-scenery-image'),seen=new Set();
  for(let day=1;day<=25;day++){
   await page.clock.setFixedTime(new Date(2026,10,day,12));
   await page.evaluate(()=>p.tick());
   await image.evaluate(img=>img.decode());
   const src=await image.getAttribute('src');
   assert.match(src,/^data:image\/webp;base64,/);
   if(day<=24)assert.equal(seen.has(src),false);
   else assert.equal(src,[...seen][0]);
   seen.add(src);
  }
  await page.locator('.td-scenery-credit').click();
  assert.match(await page.getByRole('link',{name:'原图与作者'}).getAttribute('href'),/^https:\/\/commons\.wikimedia\.org\//);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.context().setOffline(false);
 });
 await check('workspace theme is reachable on mobile, previews, persists and applies across pages',async()=>{
  await page.setViewportSize({width:360,height:900});
  await page.getByRole('button',{name:'工作台主题',exact:true}).click();
  await page.getByLabel('主题配色').selectOption('ocean');
  await page.getByLabel('界面样式').selectOption('minimal');
  assert.equal(await page.locator('.td-modal .td-panel').evaluate(e=>getComputedStyle(e).borderRadius),'3px');
  assert.equal(await page.locator('.td-host').getAttribute('data-td-color'),'classic');
  await page.getByRole('button',{name:'保存主题',exact:true}).click();
  await page.locator('.td-host[data-td-color=ocean]').waitFor();
  await page.evaluate(async()=>{await p.store.load();leaf.view.go('quadrants');});
  const card=page.locator('.td-q-today');
  assert.equal(await card.evaluate(e=>getComputedStyle(e).borderRadius),'3px');
  assert.equal(await card.evaluate(e=>getComputedStyle(e).getPropertyValue('--td-accent').trim()),'#1f63a8');
  await page.evaluate(()=>document.body.classList.add('theme-dark'));
  assert.equal(await card.evaluate(e=>getComputedStyle(e).getPropertyValue('--td-accent').trim()),'#8bc4ff');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'theme-ocean-mobile.png'),fullPage:true});
  await page.evaluate(()=>leaf.view.go('home'));
 });
 await page.addStyleTag({content:':root{--background-primary:#202222;--background-secondary:#292b2b;--background-modifier-border:#424545;--text-normal:#eee;--text-muted:#aaa}'});await page.screenshot({path:path.join(output,'home-dark.png'),fullPage:true});
 }catch(e){errors.push(e.stack);}finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed,errors},null,2));await browser?.close();server.close();if(errors.length){console.error(errors);process.exitCode=1;}console.log(`${passed.length} passed, ${errors.length} failed`);}})();
