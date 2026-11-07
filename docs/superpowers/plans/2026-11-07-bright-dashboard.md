# 明亮工作台升级

用户已选 A、B、F。首页默认展示计划和统计，工作台增加四套明亮配色。外观扩展限定在工作台。

- [x] 调整 `src/views.cjs` 和 `src/dashboard.cjs` 的首页模块。两个布局都以 `planningWidgets !== false` 为默认行为，从容布局把计划、概览与笔记统计放在常显区域。保留保存过的模块顺序和关闭设置。
- [x] 用 `C.planProgress` 在 `src/plans-view.cjs` 渲染目标倒计时和实际进度环。显示启用的每日风景，计划封面优先。通过 `completionTrend(tasks, today)` 按本地完成日期汇总含今天的 14 天，过滤回收站、未完成和缺失完成日期的记录。
- [x] 在 `styles-theme.css` 增加四套配色，在构建末尾追加 `styles-bright.css`。在插件启动时触发 `parse-style-settings`，提供独立于配色预设的可选主色覆盖、圆角、卡片不透明度滑块和减弱动效开关。
- [x] 验证新增用例先失败再通过。运行 `npm.cmd test`、`npm.cmd run build` 和隔离浏览器测试，检查桌面、窄屏、夜间以及开启自定义参数后的布局，生成 0.4.1 安装包。
