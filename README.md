# 从容 · Todo 工作台

Obsidian 插件，当前测试版 0.1.1。一个插件提供首页仪表盘及完整待办工作台，支持 Windows 与安卓界面布局。数据存储于普通库文件夹，便于 EasySync 同步。

## 安装本地测试版

1. 解压 `release/todo-dashboard-0.1.1.zip`，得到 `todo-dashboard` 文件夹。
2. 将该文件夹放到你的笔记库 `.obsidian/plugins/` 下，最终应有 `.obsidian/plugins/todo-dashboard/main.js`、`manifest.json` 和 `styles.css`。
3. 在 Obsidian 设置 → 第三方插件中关闭受限模式，刷新插件列表并启用 **Todo 工作台**。
4. 点击侧栏仪表盘按钮，或命令面板运行 **Todo 工作台：打开首页仪表盘**。重新打开 Obsidian 后默认进入首页。

电脑和平板各安装一次插件。安卓文件管理器需显示隐藏文件夹才能找到 `.obsidian`。先在测试库使用，确认后再放入日常库。

## 功能

- 首页：今日任务、逾期数、今日与本周专注时间、笔记总数和近 7 天新增/修改数量。
- 最近 8 篇笔记，切换最近创建/修改；偏好设置可排除文件夹。
- 自定义文件夹或标签统计，点击查看匹配笔记。文件夹包含子文件夹，标签精确匹配。
- 日程月历、每日任务详情、四象限、未安排日期的待办箱、分类清单和回收站。
- 任务标题、备注、日期、可选时间段、所属清单/颜色、象限、关联笔记、一层子任务。
- 清单颜色可从预设色选择或自定义。任务只有一个象限，今日待办按日期跨象限汇总。
- 每天/每周/每月重复：上一期未完成时保留并提示逾期；完成后生成完成日之后的下一个周期，不补历史任务。
- 月末按原始日期号推进，例如 1 月 31 日 → 2 月 28 日 → 3 月 31 日。
- 正计时：开始、暂停、继续、结束。任务右侧播放按钮可直接关联计时；也可开始自由专注。
- 时间轴分栏显示计划安排与实际专注区间，暂停时间不计入专注，跨午夜记录按天分配时长。
- 任务采用软删除，可在回收站恢复；不发送系统提醒。

## 数据与 EasySync

权威数据目录默认如下：

```text
Todo工作台/
  设置.md
  tasks/
    <任务ID>.md
  sessions/
    <专注记录ID>.md
```

每个任务、每条专注记录各自独立保存。Markdown 的 YAML 区包含 `todo_schema`、`todo_kind` 与 JSON 格式的 `todo_record`，后者为权威数据；正文是方便浏览的摘要。请在插件界面编辑任务，手动改正文不会改变任务状态。

EasySync 中将 `Todo工作台/` 整个目录纳入同步，Windows 与安卓使用同一笔记库。清单、颜色、自定义统计和最近笔记偏好随目录同步。不依赖同步插件的 `data.json`。计时器运行状态只保存在本设备的 localStorage；结束后的专注记录才作为文件同步，不支持运行中跨设备接力。

文件经 EasySync 下载或外部编辑后，插件监听 Vault 文件事件自动刷新。保存时比较上次读取的文件内容，发现变化则拒绝覆盖并提示重新打开编辑。重复实例使用确定性 ID 减少重复生成；完成后中断的实例生成在重载时补齐。

同一文件在两端离线同时修改仍可能触发 EasySync 冲突，需要使用 EasySync 的冲突处理。插件不宣称自动解决所有冲突。未知格式或损坏文件不会被自动修复覆盖，首页显示检查入口。

## 计时恢复

关闭或离开应用一段时间后，恢复时暂停计时，并询问是否计入离开期间的时间。可以保持暂停、计入并继续或结束保存。无后台通知和自动休息轮次。安卓系统休眠仍需实机测试。

## BRAT 安装与发布

仓库：[w3330442790-sys/obsidian-todo-dashboard](https://github.com/w3330442790-sys/obsidian-todo-dashboard)。

在电脑和安卓平板的 BRAT 设置中选择 **Add beta plugin**，输入：

```text
w3330442790-sys/obsidian-todo-dashboard
```

选择 `0.1.1` 或最新版本，安装后在 Obsidian 第三方插件列表中启用 **Todo 工作台**。发布附件见 [Releases](https://github.com/w3330442790-sys/obsidian-todo-dashboard/releases)。

维护者发布新版本的步骤：

1. 仓库包含源码和根目录 `manifest.json`。
2. 执行 `npm test` 和 `npm run build`。
3. 创建版本标签及 Release `0.1.1`，上传 `dist/main.js`、`dist/manifest.json`、`dist/styles.css` 为独立附件。
4. 两端 BRAT → Add beta plugin，填入 `用户名/仓库名` 安装。

`manifest.json` 版本与 Release 标签保持一致。可参考 [BRAT 开发者指南](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)。BRAT 负责更新程序；EasySync 负责同步普通库数据。

## 开发与验证

无运行时第三方依赖。Node.js 20 或以上：

```powershell
npm test
npm run build
```

`scripts/ui-test.cjs` 为浏览器隔离测试，需通过 `PLAYWRIGHT_PATH` 指定已安装的 Playwright，并可通过 `BROWSER_PATH` 指定浏览器。它使用内存 Vault 和模拟 Obsidian API，不读取用户笔记、不连接任何云服务。截图及报告存放 `artifacts/`。

已验证：领域/存储测试、生产打包、隔离浏览器中的主要交互与响应式布局。补充验证：Windows Obsidian 1.14.5 重新加载后样式恢复。真实安卓硬件、EasySync 双端传输和冲突处理仍需按 `ACCEPTANCE.md` 验收。

首版是独立待办系统，不读取或同步原 Todo清单账号。
