# 从容全局主题与文件排序实施计划

> 按设计验收项逐步执行，先验证失败用例，再实现和复验。

目标为可独立安装的全局主题及 Todo 工作台更新。主题通过 Obsidian 的浅色、深色变量映射两套配色。工作台继续用现有任务、专注和笔记模块。排序仅修改原生文件树返回的同级条目顺序，编辑状态使用侧栏面板。

- [x] `tests/global-theme.test.cjs` 验证模式映射和旧布局选项，构建及压缩包校验验证独立主题产物。
- [x] `src/global-theme.cjs` 封装模式切换，`theme/manifest.json`、`theme/theme.css` 定义外观，`src/views.cjs` 添加首屏网格和全局切换按钮，`scripts/build.cjs` 输出独立主题目录。
- [x] `tests/file-order.test.cjs` 验证根目录与子目录隔离、插入、重命名、删除、追加及恢复原生排序。
- [x] `src/file-order.cjs` 实现排序状态与原生排序适配，`src/explorer-order.cjs` 接入菜单、侧栏拖拽与按钮，`src/plugin.cjs` 保存每库顺序并注册文件事件。
- [x] 运行 `npm test`、`npm run build`，在隔离 Windows Obsidian 测试库验证首页、切换、排序、重启和恢复默认。校验两个安装包。

验收环境包括 Windows Obsidian 1.15.0 和浏览器模拟 Android 横屏。模拟测试验证触控尺寸下的工作台首屏与任务入口，Android 实机验收待设备测试。
