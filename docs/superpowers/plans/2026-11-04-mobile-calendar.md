# 手机月历实施计划

**Goal:** 修复月历任务密度和手机风景按钮，交付 0.3.4 安装包。

**Architecture:** 使用现有 views.cjs 和 DashboardView 状态；追加局部高优先级 CSS，避免通用按钮和 Obsidian 主题覆盖。

**Tech Stack:** CommonJS、CSS container queries、Node test、Playwright 内存 Vault。

- [x] 在 scripts/calendar-ui-test.cjs 编写回归，先在旧构建确认默认完成筛选、同日多任务和署名尺寸失败。
- [x] src/plugin.cjs 默认 showDone=true；src/views.cjs 用日期头和可滚动任务容器渲染全部任务，补日期/总数无障碍说明。
- [x] styles-mobile.css 声明 .td-calendar 内日期、任务按钮尺寸与文本换行，并声明风景按钮独立字体与内边距。build.cjs 最后合并该文件。
- [x] 浏览器验证手机、平板、桌面及通用大按钮主题，检查长标题、滚动、点击编辑、完成筛选、跨日任务与暗色。
- [x] npm test、npm run build、原 UI 回归、git diff --check；核对截图。
- [x] 更新 0.3.4 版本与发布说明，生成安装 ZIP；备份后安装本机程序三文件并核对哈希。
- [ ] 发布供 BRAT 更新：自动审批要求用户明确批准 GitHub 公开发布，确认已提交。

验证结果：128 项自动测试、18 项新增界面检查、9 项计划/时间轴回归、36 项原界面回归通过。手机尺寸为浏览器模拟，安卓硬件未验收。
