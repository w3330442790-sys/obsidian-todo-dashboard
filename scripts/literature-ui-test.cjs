'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'artifacts','literature');
fs.mkdirSync(output,{recursive:true});
const server = http.createServer((req,res) => {
  const file = path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root+path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file,(error,data) => {
    if (error) { res.writeHead(404).end(); return; }
    const type = {'.html':'text/html','.css':'text/css'}[path.extname(file)] || 'text/javascript';
    res.setHeader('Content-Type',type+'; charset=utf-8');
    res.end(data);
  });
});

async function seed(page) {
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(async () => {
    const titles = ['免疫治疗相关肝损伤的临床特征与结局','肝纤维化的长期队列研究','肝癌系统治疗的多中心试验',
      '临床真实世界数据中的药物安全信号','慢性肝病分层管理的研究进展','代谢相关肝病的诊疗路径',
      '药物性肝损伤患者的早期随访结果','肝硬化并发症的观察性分析','肝组织病理改变与预后指标',
      '晚期肝病诊疗共识的证据回顾','免疫相关不良反应的长期监测','临床研究中的肝酶变化'];
    for (let i=0;i<titles.length;i++) {
      await p.store.saveLiterature({id:'lit-'+i,title:titles[i],
        authors:i===0?'Ding, Mei; Chen, Li; Sun, Ting; Lu, Ping; Gu, Wei; Guo, Yan':'Chen, Li; Sun, Ting',
        publicationDate:i===0?'2024-03':`2025-${String(i).padStart(2,'0')}`,publicationTitle:i===0?'Clinical Hepatology':'Medical Research',
        bibliography:{itemType:'journalArticle',volume:'80',issue:'3',pages:'431–442',journalAbbreviation:'Clin. Hepatol.',
          issn:'0168-8278',abstractNote:'本研究评价免疫治疗人群的肝损伤发生风险。'},
        rating:i===0?4:null,memo:i===0?'重点查看分层结局。':'',doi:'10.1000/fixture'+i,
        status:i===0?'reading':'unread',currentPage:i===0?4:null,totalPages:i===0?10:null,
        pdfPath:i===0?'科研/模拟附件.pdf':'',notePath:i===0?'科研/文献阅读记录.md':'',
        collections:i%2===0?['肝损伤']:['临床研究'],tags:i===0?['免疫治疗']:['综述'],
        metrics:{impactFactor:i===0?33:4.1,jcrQuartile:i%2===0?'Q1':'Q2',casMajor:'医学1区'},
        updatedAt:new Date(Date.UTC(2026,0,25-i)).toISOString()});
    }
    p.refresh();
  });
  await page.getByRole('button',{name:'文献专区',exact:true}).click();
}

(async () => {
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const url = `http://127.0.0.1:${server.address().port}/tests/preview.html`;
    const errors = [];
    const page = await browser.newPage({viewport:{width:1560,height:970}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await seed(page);
    const table = page.getByRole('table',{name:'文献条目'});
    const detail = page.getByRole('complementary',{name:'条目详情'});
    const first = table.getByRole('button',{name:'免疫治疗相关肝损伤的临床特征与结局',exact:true});
    assert.equal(await table.locator('.td-lit-item-row').count(),12);
    assert.equal(await detail.getByText('431–442',{exact:true}).isVisible(),true);
    assert.equal(await detail.getByText('重点查看分层结局。',{exact:true}).isVisible(),true);
    await detail.getByRole('button',{name:'显示其余 1 位作者'}).click();
    assert.equal(await detail.getByText('Guo, Yan',{exact:true}).isVisible(),true);
    await table.getByRole('button',{name:/展开附件/}).click();
    assert.equal(await table.getByRole('button',{name:'PDF · 模拟附件.pdf',exact:true}).isVisible(),true);
    await table.getByRole('button',{name:/收起附件/}).click();
    await page.locator('.td-lit-library').screenshot({path:path.join(output,'desktop.png')});
    await first.press('ArrowDown');
    assert.equal(await detail.getByRole('heading',{name:'肝纤维化的长期队列研究'}).isVisible(),true);
    const date = table.getByRole('columnheader',{name:/日期/});
    await date.getByRole('button').click();
    assert.equal(await date.getAttribute('aria-sort'),'descending');
    assert.equal(await table.locator('.td-lit-date').first().innerText(),'2025-11');
    await page.getByRole('searchbox',{name:'搜索文献'}).fill('重点查看 q1');
    assert.equal(await table.locator('.td-lit-item-row').count(),1);
    await page.getByRole('searchbox',{name:'搜索文献'}).fill('');
    await page.getByRole('button',{name:/^肝损伤 6/}).click();
    assert.equal(await table.locator('.td-lit-item-row').count(),6);
    await first.click();
    await detail.getByRole('button',{name:'编辑文献'}).click();
    assert.equal(await page.getByLabel('发表日期（年、年-月或年-月-日）').inputValue(),'2024-03');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(() => {
      p.zoteroLocal.read = async () => ({records:[
        {title:'Local Zotero fixture',zoteroKey:'ABCD2345',publicationDate:'2026-05',collections:['Zotero']}
      ],skipped:0});
    });
    const refresh = page.getByRole('button',{name:'从 Zotero 刷新',exact:true});
    await refresh.click();
    await page.waitForFunction(() => window.lastNotice?.includes('新增 1'));
    await refresh.click();
    await page.waitForFunction(() => window.lastNotice?.includes('新增 0'));
    assert.equal(await page.evaluate(()=>[...p.store.literature.values()].filter(paper=>paper.zoteroKey==='ABCD2345').length),1);

    const mobile = await browser.newPage({viewport:{width:420,height:880},isMobile:true,hasTouch:true});
    mobile.on('pageerror',error=>errors.push(error.message));
    await mobile.goto(url+'?tablet');
    await seed(mobile);
    const mobileDetails = mobile.getByRole('complementary',{name:'条目详情'});
    assert.equal(await mobileDetails.count(),0);
    await mobile.getByRole('button',{name:'免疫治疗相关肝损伤的临床特征与结局',exact:true}).click();
    assert.equal(await mobileDetails.getByText('431–442',{exact:true}).isVisible(),true);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mobileDetails.screenshot({path:path.join(output,'mobile-details.png')});
    await mobileDetails.getByRole('button',{name:'返回列表'}).click();
    assert.equal(await mobileDetails.count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS desktop table, details, keyboard selection, attachment expansion, sort, search, collection, metadata edit, and narrow layout');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.close();
  }
})();
