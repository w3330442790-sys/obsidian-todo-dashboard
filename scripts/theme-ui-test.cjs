'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'congrong');
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
  assert.ok(boxes.every(box => box.bottom <= page.viewportSize().height));
  assert.ok(boxes.every(box => Math.abs(box.bottom-box.surfaceBottom)<1));
  const title = page.locator('[data-widget=today] .td-panel-heading');
  assert.equal(await title.getByRole('button', {name:'快速记任务', exact:true}).count(), 1);
  assert.equal(await title.getByRole('button', {name:/逾期/}).count(), 1);
}

async function main() {
  await fs.mkdir(out, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:browserPath});
  try {
    const desktop = await open(browser, {width:1280, height:800});
    const {page} = desktop;
    await checkLayout(page);
    await page.screenshot({path:path.join(out,'warm-desktop.png')});
    const draft = page.getByRole('textbox', {name:'灵感内容'});
    await draft.fill('主题切换保留这条草稿');
    await page.getByRole('button', {name:'夜蓝', exact:true}).click();
    assert.equal(await page.getByRole('button', {name:'夜蓝', exact:true}).getAttribute('aria-pressed'), 'true');
    assert.equal(await draft.inputValue(), '主题切换保留这条草稿');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--background-primary').trim()), '#101821');
    await draft.fill('');
    await page.screenshot({path:path.join(out,'night-desktop.png')});
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
    assert.equal(await scroll.locator('.td-task').count(), 10);
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
    assert.deepEqual([...desktop.errors, ...tablet.errors], []);
    console.log('PASS desktop and tablet first screen, theme switch, draft retention, custom layout and full task list');
  } finally {
    await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
