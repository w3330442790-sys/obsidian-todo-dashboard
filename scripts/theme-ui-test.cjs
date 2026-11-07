'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'day-night');
const credits = require('../assets/scenery/credits.json');
const origin = 'http://congrong-preview.invalid';
const browserPath = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const headings = ['today', 'week', 'focus', 'recent', 'inspiration', 'reflection'];

async function open(browser, viewport, tablet = false) {
  const page = await browser.newPage({viewport, hasTouch: tablet});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    const local = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!local.startsWith(root + path.sep)) return route.abort();
    const data = await fs.readFile(local).catch(() => null);
    if (!data) return route.fulfill({status: 404});
    const type = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript'}[path.extname(local)] || 'text/plain';
    await route.fulfill({contentType: type + '; charset=utf-8', body: data});
  });
  await page.goto(origin + '/tests/preview.html?congrong' + (tablet ? '&tablet' : ''));
  await page.waitForFunction(() => window.ready === true);
  page.setDefaultTimeout(8000);
  return {page, errors};
}

async function checkLayout(page) {
  const boxes = await page.locator('.td-theme-home-grid .td-widget').evaluateAll(elements =>
    elements.map(node => {
      const {left, top, bottom} = node.getBoundingClientRect();
      const surface = node.querySelector('.td-panel, .td-focus').getBoundingClientRect();
      return {id: node.dataset.widget, left, top, bottom, surfaceBottom: surface.bottom};
    }));
  assert.deepEqual(boxes.map(box => box.id), headings);
  assert.ok(boxes[0].left < boxes[1].left);
  assert.equal(boxes[1].left, boxes[2].left);
  assert.ok(boxes[1].top < boxes[2].top);
  assert.equal(boxes[3].top, boxes[4].top);
  assert.equal(boxes[3].top, boxes[5].top);
  assert.ok(boxes[0].top < page.viewportSize().height);
  assert.ok(boxes.every(box => Math.abs(box.bottom-box.surfaceBottom)<1));
  const title = page.locator('[data-widget=today] .td-panel-heading');
  assert.equal(await title.getByRole('button', {name:'快速记任务', exact:true}).count(), 1);
  assert.equal(await title.getByRole('button', {name:/逾期/}).count(), 1);
}

async function checkUpgrade(page) {
  for (const id of ['plans','stats','custom','trend']) {
    await page.locator(`[data-widget=${id}]`).waitFor();
  }
  await page.evaluate(async () => {
    const today = p.lastDay;
    const goal = {id:'goal',title:'完成十个小目标',kind:'count',value:4,target:10};
    await p.store.savePlan({id:'test-plan',title:'考试复习计划',status:'open',
      startDate:today,endDate:today,goals:[goal]});
    const source = p.store.tasks.get('demo-0');
    await p.saveTask({...source,id:'completed-for-trend',repeat:'none',status:'done',completedAt:today});
    p.refresh();
  });
  assert.equal(await page.getByRole('progressbar',{name:'考试复习计划 完成进度'}).getAttribute('aria-valuenow'),'40');
  assert.equal(await page.locator('.td-plan-countdown').textContent(),'今天到期');
  await page.waitForFunction(() => document.querySelector('.td-plan-hero-image')?.naturalWidth > 0);
  const trend = page.getByRole('table',{name:'任务完成趋势'});
  assert.equal(await trend.getByRole('columnheader').count(),14);
  assert.equal(await trend.locator('.td-trend-count').last().textContent(),'1');
  assert.match(await page.locator('.td-trend-total').textContent(),/共完成 1 项/);

  const host = page.locator('.td-host');
  await page.getByRole('button',{name:'工作台主题'}).click();
  await page.getByLabel('白天配色',{exact:true}).selectOption('honey');
  await page.getByLabel('夜晚配色',{exact:true}).selectOption('firefly');
  await page.waitForFunction(() => [...document.querySelectorAll('.td-theme-art-preview')].every(img=>img.naturalWidth>0));
  assert.equal(await page.getByLabel('夜晚配色',{exact:true}).locator('option[value=honey]').count(),0);
  assert.equal(await page.getByLabel('白天配色',{exact:true}).locator('option[value=firefly]').count(),0);
  await page.getByLabel('界面样式',{exact:true}).selectOption('soft');
  await page.getByRole('button',{name:'保存主题'}).click();
  assert.equal(await host.getAttribute('data-td-color'),'honey');
  assert.equal(await host.evaluate(e=>getComputedStyle(e).getPropertyValue('--td-accent').trim()),'#235b97');
  const scene=page.locator('.td-scenery');
  assert.equal(await scene.getAttribute('data-illustration'),'art-honey-window.webp');
  await page.getByRole('button',{name:'夜晚',exact:true}).click();
  assert.equal(await host.getAttribute('data-td-color'),'firefly');
  assert.equal(await host.evaluate(e=>getComputedStyle(e).getPropertyValue('--td-accent').trim()),'#96e6cb');
  assert.equal(await scene.getAttribute('data-illustration'),'art-lantern-garden.webp');
  await page.getByRole('button',{name:'风景设置',exact:true}).click();
  await page.getByLabel('风景来源',{exact:true}).selectOption('photos');
  await page.getByLabel(/图库文件夹/).fill('测试用空图库');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal(await scene.getAttribute('data-illustration'),null);
  const photo=scene.locator('img');
  await page.waitForFunction(() => document.querySelector('.td-scenery-image')?.naturalWidth > 0);
  const nightPhotos=credits.filter(entry=>entry.photoMode==='night').map(entry=>entry.label);
  assert.ok(nightPhotos.includes(await photo.getAttribute('alt')));
  await page.getByRole('button',{name:'白天',exact:true}).click();
  assert.equal(await host.getAttribute('data-td-color'),'honey');
  assert.ok(!nightPhotos.includes(await photo.getAttribute('alt')));
  await page.getByRole('button',{name:'风景设置',exact:true}).click();
  await page.getByLabel('风景来源',{exact:true}).selectOption('illustrations');
  await page.getByLabel(/固定图片/).fill('Todo工作台/风景图库/01-moraine-lake.jpg');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal(await scene.getAttribute('data-illustration'),null);
  assert.match(await photo.getAttribute('src'),/01-moraine-lake.jpg$/);
  await page.getByRole('button',{name:'风景设置',exact:true}).click();
  await page.getByLabel(/固定图片/).fill('');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal(await scene.getAttribute('data-illustration'),'art-honey-window.webp');

  const panel = page.locator('[data-widget=plans] .td-panel');
  assert.equal(await panel.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'20px');
  const surface = page.locator('.td-plan-hero-surface');
  const oldSurface = await surface.evaluate(e=>getComputedStyle(e).backgroundColor);
  await page.evaluate(() => {
    document.body.classList.add('td-style-accent-enabled','td-style-no-motion');
    document.body.style.setProperty('--td-style-accent','#ae246a');
    document.body.style.setProperty('--td-style-card-radius','26px');
    document.body.style.setProperty('--td-style-scenery-opacity','76%');
  });
  assert.equal(await panel.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'26px');
  assert.equal(await panel.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  assert.notEqual(await surface.evaluate(e=>getComputedStyle(e).backgroundColor),oldSurface);
  assert.match(await host.evaluate(e=>getComputedStyle(e).getPropertyValue('--td-accent')),/#ae246a/);
  await page.evaluate(() => {
    document.body.classList.remove('td-style-accent-enabled','td-style-no-motion');
    for(const name of ['accent','card-radius','scenery-opacity'])document.body.style.removeProperty('--td-style-'+name);
  });
  await page.locator('.td-layout-tools > summary').click();
  await page.getByRole('button',{name:'隐藏计划模块',exact:true}).click();
  await page.locator('[data-widget=plans]').waitFor({state:'detached'});
  await page.locator('[data-widget=stats]').waitFor();
  await page.locator('.td-layout-tools > summary').click();
  await page.getByRole('button',{name:'显示计划模块',exact:true}).click();
  await page.locator('[data-widget=plans]').waitFor();
}

async function main() {
  await fs.mkdir(out, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:browserPath});
  try {
    const desktop = await open(browser, {width:1280, height:800});
    const {page} = desktop;
    await checkLayout(page);
    await checkUpgrade(page);
    await page.screenshot({path:path.join(out,'day-desktop.png'),fullPage:true});
    const draft = page.getByRole('textbox', {name:'灵感内容'});
    await draft.fill('主题切换保留这条草稿');
    await page.getByRole('button', {name:'夜晚', exact:true}).click();
    assert.equal(await page.getByRole('button', {name:'夜晚', exact:true}).getAttribute('aria-pressed'), 'true');
    assert.equal(await draft.inputValue(), '主题切换保留这条草稿');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--background-primary').trim()), '#101821');
    await draft.fill('');
    await page.screenshot({path:path.join(out,'night-desktop.png'),fullPage:true});
    await page.locator('.td-layout-tools > summary').click();
    await page.getByRole('button', {name:'使用自定义布局'}).click();
    await page.locator('.td-widget-grid').waitFor();
    await page.locator('.td-layout-tools > summary').click();
    await page.getByRole('button', {name:'应用从容布局'}).click();
    await page.locator('.td-theme-home-grid').waitFor();
    await page.evaluate(async () => {
      const source = p.store.tasks.get('demo-0');
      for (let i=0;i<8;i++) await p.saveTask({...source,id:'scroll-'+i,repeat:'none',title:'滚动任务 '+i});
    });
    const scroll = page.locator('[data-widget=today] .td-task-scroll');
    assert.equal(await scroll.locator('.td-task').count(), 11);
    assert.ok(await scroll.evaluate(element=>{
      element.scrollTop=element.scrollHeight;
      return element.scrollTop>0;
    }));

    const tablet = await open(browser, {width:1040, height:720}, true);
    await checkLayout(tablet.page);
    await tablet.page.evaluate(async () => {
      const source = p.store.tasks.get('demo-0');
      for (const id of ['tablet-1','tablet-2']) {
        await p.saveTask({...source, id, repeat:'none', title:'额外任务 ' + id});
      }
    });
    assert.equal(await tablet.page.locator('[data-widget=today] .td-task').count(), 3);
    await tablet.page.screenshot({path:path.join(out,'warm-tablet.png')});
    await tablet.page.getByRole('button', {name:'查看全部', exact:true}).click();
    const today = tablet.page.locator('.td-main .td-panel').filter({has:tablet.page.getByRole('heading',{name:'今天',exact:true})});
    assert.equal(await today.locator('.td-task').count(), 4);
    const mobile = await open(browser,{width:390,height:844},true);
    await checkUpgrade(mobile.page);
    assert.equal(await mobile.page.locator('.td-host').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    const chartWidths = await mobile.page.locator('.td-trend-scroll').evaluate(e=>({
      client:e.clientWidth, scroll:e.scrollWidth,
      table:e.firstElementChild.getBoundingClientRect().width,
      date:e.querySelector('th:last-child time').getBoundingClientRect().toJSON()
    }));
    assert.ok(chartWidths.scroll<=chartWidths.client,JSON.stringify(chartWidths));
    const width = selector=>mobile.page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);
    assert.equal(await width('[data-widget=stats]'),await width('[data-widget=plans]'));
    await mobile.page.screenshot({path:path.join(out,'day-mobile.png'),fullPage:true});
    assert.deepEqual([...desktop.errors, ...tablet.errors, ...mobile.errors], []);
    console.log('PASS desktop, tablet and phone layouts, plan countdown and trend, theme and CSS settings, draft retention and full task list');
  } finally {
    await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
